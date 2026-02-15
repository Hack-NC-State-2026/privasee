"""Overlay summary API: top-3 high-risk attributes + evidence for a domain."""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.queries import get_json
from app.api.tos_processor.models import PolicyAnalysis
from app.severity_store import get_site_attributes
from app.utils.url_utils import get_domain

router = APIRouter(prefix="/overlay_summary", tags=["overlay_summary"])
logger = logging.getLogger(__name__)

TOS_CACHE_PREFIX = "tos:process:"

# Map each attribute name to its data-collection section type (for deduplicating by type in overlay).
# Section types align with data_collection in PolicyAnalysis: one entry per "category" of data.
ATTRIBUTE_TO_SECTION_TYPE: dict[str, str] = {
    # personal_identifiers
    "name": "personal_identifiers",
    "email": "personal_identifiers",
    "phone_number": "personal_identifiers",
    "physical_address": "personal_identifiers",
    "date_of_birth": "personal_identifiers",
    "government_id": "personal_identifiers",
    "financial_account": "personal_identifiers",
    "biometric": "sensitive_data",
    "photo": "personal_identifiers",
    "gender": "personal_identifiers",
    "nationality": "personal_identifiers",
    "race_ethnicity": "sensitive_data",
    # ip_address (own section)
    "ip_address": "ip_address",
    # precise_location
    "precise_gps": "precise_location",
    "coarse_location": "precise_location",
    "wifi_cell": "precise_location",
    "ip_derived": "precise_location",
    # device_fingerprinting
    "device_id": "device_fingerprinting",
    "browser_info": "device_fingerprinting",
    "os": "device_fingerprinting",
    "screen_resolution": "device_fingerprinting",
    "language": "device_fingerprinting",
    "timezone": "device_fingerprinting",
    "fingerprint": "device_fingerprinting",
    # user_content
    "posts": "user_content",
    "messages": "user_content",
    "photos": "user_content",
    "videos": "user_content",
    "search_history": "user_content",
    "purchase_history": "user_content",
    "contacts": "user_content",
    # third_party_data
    "social_media": "third_party_data",
    "advertisers": "third_party_data",
    "analytics": "third_party_data",
    "data_brokers": "third_party_data",
    "affiliates": "third_party_data",
    # sensitive_data
    "health": "sensitive_data",
    "genetic": "sensitive_data",
    "political": "sensitive_data",
    "religious": "sensitive_data",
    "sexual_orientation": "sensitive_data",
    "union_membership": "sensitive_data",
    "criminal": "sensitive_data",
    # age/special (treat as sensitive for overlay)
    "age_under_13": "sensitive_data",
    "age_13_to_17": "sensitive_data",
    "parental_consent_required": "sensitive_data",
}


def _attribute_section_type(attr_name: str) -> str:
    """Return the data-collection section type for this attribute; fallback to attribute name if unknown."""
    return ATTRIBUTE_TO_SECTION_TYPE.get(attr_name, attr_name)


def _cache_key_for_domain(domain: str) -> str:
    return f"{TOS_CACHE_PREFIX}{domain}"


def _normalize_domain(raw_domain: str) -> str:
    """Normalize host/subdomain input to registered root domain."""
    candidate = raw_domain.strip()
    if not candidate:
        return candidate
    # Accept both host-only values and full URLs.
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    normalized = get_domain(candidate)
    return normalized or raw_domain.strip()


def _format_attribute_name(value: str) -> str:
    """Convert underscore-separated attribute names to Title Case."""
    return value.replace("_", " ").title()


def _get_section_for_attribute(attr: str, data_collection: dict[str, Any]) -> dict[str, Any] | None:
    """Return the data_collection section dict that contains *attr* (for evidence, explanation, mitigation)."""
    typed_sections = (
        "personal_identifiers",
        "precise_location",
        "device_fingerprinting",
        "user_content",
        "third_party_data",
        "sensitive_data",
    )
    for section_key in typed_sections:
        section = data_collection.get(section_key)
        if not isinstance(section, dict):
            continue
        types = section.get("types", [])
        if isinstance(types, list) and attr in types:
            return section
    if attr == "ip_address":
        ip_signal = data_collection.get("ip_address")
        if isinstance(ip_signal, dict):
            return ip_signal
    return None


def _get_evidence_for_attribute(attr: str, analysis: dict[str, Any]) -> str:
    """Return the first matching evidence string for *attr* from the cached analysis."""
    data_collection: dict[str, Any] = analysis.get("data_collection", {})
    section = _get_section_for_attribute(attr, data_collection)
    if section:
        evidence = section.get("evidence", "")
        if evidence:
            return str(evidence)
    return ""


def _get_explanation_for_attribute(attr: str, analysis: dict[str, Any]) -> str:
    """Return the explanation string for *attr* from the cached analysis."""
    data_collection: dict[str, Any] = analysis.get("data_collection", {})
    section = _get_section_for_attribute(attr, data_collection)
    if section:
        return str(section.get("explanation", "") or "")
    return ""


def _get_mitigation_for_attribute(attr: str, analysis: dict[str, Any]) -> str:
    """Return the mitigation string for *attr* from the cached analysis."""
    data_collection: dict[str, Any] = analysis.get("data_collection", {})
    section = _get_section_for_attribute(attr, data_collection)
    if section:
        return str(section.get("mitigation", "") or "")
    return ""


def compute_top_risks(domain: str) -> dict[str, Any]:
    """
    Compute the top-3 high-risk (red) attributes for *domain*, enriched with
    title, evidence, and explanation; add Data Retention Policy section; add
    mitigations for the top 2 of those risks.

    Returns::

        {
            "domain": "google.com",
            "top_high_risk_attributes": [
                {
                    "title": "...",
                    "evidence": "...",
                    "explanation": "...",
                    "color": "red",
                    "sensitivity_level": 20
                }
            ],
            "data_retention_policy": {
                "title": "Data Retention Policy",
                "explanation": "..."
            },
            "mitigations": [
                { "title": "...", "mitigation": "..." },
                { "title": "...", "mitigation": "..." }
            ],
            "has_cached_analysis": true
        }
    """
    normalized_domain = _normalize_domain(domain)
    logger.info(
        ">>> compute_top_risks called for domain=%s normalized=%s",
        domain,
        normalized_domain,
    )

    # 1. All attributes sorted by sensitivity (highest first)
    all_attrs = get_site_attributes(normalized_domain)
    logger.info("All attributes for %s: %s", normalized_domain, all_attrs)

    # 2. Keep only red (high risk); take first 3 with distinct section types (no duplicate categories)
    red_attrs = [a for a in all_attrs if a.get("color") == "red"]
    seen_section_types: set[str] = set()
    top_3: list[dict[str, Any]] = []
    for a in red_attrs:
        attr_name = a.get("attribute")
        if not attr_name:
            continue
        section_type = _attribute_section_type(attr_name)
        if section_type in seen_section_types:
            continue
        seen_section_types.add(section_type)
        top_3.append(a)
        if len(top_3) >= 3:
            break
    logger.info("Top-3 high-risk (red) attributes for %s: %s", normalized_domain, top_3)

    # 3. Cached TOS analysis (for evidence, explanation, retention, mitigation)
    cache_key = _cache_key_for_domain(normalized_domain)
    try:
        cached = get_json(cache_key, PolicyAnalysis)
    except Exception as e:
        logger.warning("Cache lookup failed for %s: %s", cache_key, e)
        cached = None

    analysis_dict: dict[str, Any] = cached.model_dump() if cached else {}

    # 4. Build enriched top-3: title (heading), evidence, explanation
    enriched: list[dict[str, Any]] = []
    for item in top_3:
        attr_name: str = item["attribute"]
        evidence = _get_evidence_for_attribute(attr_name, analysis_dict)
        explanation = _get_explanation_for_attribute(attr_name, analysis_dict)
        enriched.append({
            "title": _format_attribute_name(attr_name),
            "evidence": evidence,
            "explanation": explanation,
            "color": item["color"],
            "sensitivity_level": item["sensitivity_level"],
        })

    # 5. Data Retention Policy: title + explanation from retention.retention_explanation
    retention = analysis_dict.get("retention") or {}
    retention_explanation = str(retention.get("retention_explanation") or "").strip()
    data_retention_policy: dict[str, Any] = {
        "title": "Data Retention Policy",
        "explanation": retention_explanation,
    }

    # 6. Mitigations for top 2 of the top-3 risks
    mitigations: list[dict[str, Any]] = []
    for item in top_3[:2]:
        attr_name = item["attribute"]
        mitigation = _get_mitigation_for_attribute(attr_name, analysis_dict)
        mitigations.append({
            "title": _format_attribute_name(attr_name),
            "mitigation": mitigation,
        })

    result: dict[str, Any] = {
        "domain": normalized_domain,
        "top_high_risk_attributes": enriched,
        "data_retention_policy": data_retention_policy,
        "mitigations": mitigations,
        "has_cached_analysis": cached is not None,
    }

    logger.info(
        "Overlay summary for %s — top 3 high-risk: %s; retention: %s; mitigations: %s",
        normalized_domain,
        enriched,
        data_retention_policy.get("explanation", "")[:80],
        mitigations,
    )

    return result


@router.get("/top_risks")
def get_top_risks(
    domain: str = Query(..., description="Domain to look up, e.g. google.com"),
) -> dict[str, Any]:
    """
    Return the top-3 high-risk (red) attributes with title, evidence, and
    explanation; a Data Retention Policy section with explanation; and
    mitigations for the top 2 of those risks.
    """
    try:
        return compute_top_risks(domain)
    except Exception as e:
        logger.error("Failed to compute top risks for %s: %s", domain, e)
        raise HTTPException(status_code=503, detail=str(e)) from e
