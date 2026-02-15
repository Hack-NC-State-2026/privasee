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


def _get_evidence_for_attribute(attr: str, analysis: dict[str, Any]) -> str:
    """Return the first matching evidence string for *attr* from the cached analysis."""
    data_collection: dict[str, Any] = analysis.get("data_collection", {})

    # Sections whose "types" list may contain the attribute
    typed_sections = (
        "personal_identifiers",
        "precise_location",
        "device_fingerprinting",
        "user_content",
        "third_party_data",
        "sensitive_data",
        "children_data",
    )

    for section_key in typed_sections:
        section = data_collection.get(section_key)
        if not isinstance(section, dict):
            continue
        types = section.get("types", [])
        if isinstance(types, list) and attr in types:
            evidence = section.get("evidence", "")
            if evidence:
                return str(evidence)

    # ip_address is a Signal (not in a types list)
    if attr == "ip_address":
        ip_signal = data_collection.get("ip_address")
        if isinstance(ip_signal, dict):
            evidence = ip_signal.get("evidence", "")
            if evidence:
                return str(evidence)

    return ""


def compute_top_risks(domain: str) -> dict[str, Any]:
    """
    Compute the top-3 high-risk (red) attributes for *domain*, enriched with
    human-readable titles and evidence text from the cached TOS analysis.

    This is the shared core used by both the ``/overlay_summary/top_risks``
    endpoint and the ``tos_processor`` cache-hit path.

    Returns::

        {
            "domain": "google.com",
            "top_high_risk_attributes": [
                {
                    "title": "Parental Consent Required",
                    "evidence": "If you're under …",
                    "color": "red",
                    "sensitivity_level": 20
                }
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

    # 2. Keep only red (high risk), take first 3
    red_attrs = [a for a in all_attrs if a.get("color") == "red"]
    top_3 = red_attrs[:3]
    logger.info("Top-3 high-risk (red) attributes for %s: %s", normalized_domain, top_3)

    # 3. Cached TOS analysis (for evidence lookup)
    cache_key = _cache_key_for_domain(normalized_domain)
    try:
        cached = get_json(cache_key, PolicyAnalysis)
    except Exception as e:
        logger.warning("Cache lookup failed for %s: %s", cache_key, e)
        cached = None

    analysis_dict: dict[str, Any] = cached.model_dump() if cached else {}

    # 4. Build enriched items: human-readable title + evidence
    enriched: list[dict[str, Any]] = []
    for item in top_3:
        attr_name: str = item["attribute"]
        evidence = _get_evidence_for_attribute(attr_name, analysis_dict)
        enriched.append({
            "title": _format_attribute_name(attr_name),
            "evidence": evidence,
            "color": item["color"],
            "sensitivity_level": item["sensitivity_level"],
        })

    result: dict[str, Any] = {
        "domain": normalized_domain,
        "top_high_risk_attributes": enriched,
        "has_cached_analysis": cached is not None,
    }

    logger.info(
        "Overlay summary for %s — top 3 high-risk: %s",
        normalized_domain,
        enriched,
    )

    return result


@router.get("/top_risks")
def get_top_risks(
    domain: str = Query(..., description="Domain to look up, e.g. google.com"),
) -> dict[str, Any]:
    """
    Return the top-3 high-risk (red) attributes for a domain from the ZSET,
    enriched with human-readable titles and evidence text from the cached
    TOS analysis.
    """
    try:
        return compute_top_risks(domain)
    except Exception as e:
        logger.error("Failed to compute top risks for %s: %s", domain, e)
        raise HTTPException(status_code=503, detail=str(e)) from e
