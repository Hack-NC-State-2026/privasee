"""Attribute severity map and per-site attribute storage in Valkey."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.db import get_client

logger = logging.getLogger(__name__)

SEVERITY_KEY = "config:attribute_severity"
SITE_ATTRS_PREFIX = "tos:attrs:"

# Per-attribute entry: color + sensitivity_level. ZSET uses sensitivity_level as score.
SeverityEntry = dict[str, Any]  # {"color": str, "sensitivity_level": int}

# Default attribute -> {color, sensitivity_level}. Used to seed Valkey (HSET, value = JSON).
DEFAULT_ATTRIBUTE_SEVERITY: dict[str, SeverityEntry] = {
    "name": {"color": "yellow", "sensitivity_level": 3},
    "email": {"color": "yellow", "sensitivity_level": 4},
    "phone_number": {"color": "yellow", "sensitivity_level": 5},
    "physical_address": {"color": "red", "sensitivity_level": 1},
    "date_of_birth": {"color": "yellow", "sensitivity_level": 2},
    "government_id": {"color": "red", "sensitivity_level": 9},
    "financial_account": {"color": "red", "sensitivity_level": 10},
    "biometric": {"color": "red", "sensitivity_level": 2},
    "photo": {"color": "yellow", "sensitivity_level": 9},
    "gender": {"color": "yellow", "sensitivity_level": 18},
    "nationality": {"color": "yellow", "sensitivity_level": 17},
    "race_ethnicity": {"color": "red", "sensitivity_level": 17},
    "ip_address": {"color": "yellow", "sensitivity_level": 6},
    "device_id": {"color": "yellow", "sensitivity_level": 8},
    "browser_info": {"color": "green", "sensitivity_level": 2},
    "os": {"color": "green", "sensitivity_level": 3},
    "screen_resolution": {"color": "green", "sensitivity_level": 4},
    "language": {"color": "green", "sensitivity_level": 5},
    "timezone": {"color": "green", "sensitivity_level": 6},
    "fingerprint": {"color": "red", "sensitivity_level": 13},
    "precise_gps": {"color": "red", "sensitivity_level": 11},
    "coarse_location": {"color": "green", "sensitivity_level": 7},
    "wifi_cell": {"color": "red", "sensitivity_level": 12},
    "ip_derived": {"color": "yellow", "sensitivity_level": 7},
    "posts": {"color": "yellow", "sensitivity_level": 12},
    "messages": {"color": "red", "sensitivity_level": 14},
    "photos": {"color": "yellow", "sensitivity_level": 10},
    "videos": {"color": "yellow", "sensitivity_level": 11},
    "search_history": {"color": "red", "sensitivity_level": 15},
    "purchase_history": {"color": "yellow", "sensitivity_level": 13},
    "contacts": {"color": "red", "sensitivity_level": 16},
    "social_media": {"color": "yellow", "sensitivity_level": 14},
    "advertisers": {"color": "yellow", "sensitivity_level": 15},
    "analytics": {"color": "green", "sensitivity_level": 1},
    "data_brokers": {"color": "yellow", "sensitivity_level": 16},
    "affiliates": {"color": "green", "sensitivity_level": 8},
    "health": {"color": "red", "sensitivity_level": 3},
    "genetic": {"color": "red", "sensitivity_level": 1},
    "political": {"color": "red", "sensitivity_level": 5},
    "religious": {"color": "red", "sensitivity_level": 6},
    "sexual_orientation": {"color": "red", "sensitivity_level": 4},
    "union_membership": {"color": "red", "sensitivity_level": 7},
    "criminal": {"color": "red", "sensitivity_level": 8},
    "age_under_13": {"color": "red", "sensitivity_level": 18},
    "age_13_to_17": {"color": "red", "sensitivity_level": 19},
    "parental_consent_required": {"color": "red", "sensitivity_level": 20},
}


def get_attribute_severity_map() -> dict[str, SeverityEntry]:
    """
    Return the full attribute -> {color, sensitivity_level} map from Valkey.

    Each value is {"color": "red"|"yellow"|"green", "sensitivity_level": int}.
    Empty dict if not set. Supports legacy stored values (plain color string) by
    normalizing to the new shape with sensitivity_level from defaults.
    """
    client = get_client()
    raw = client.hgetall(SEVERITY_KEY)
    if not raw:
        return {}
    out: dict[str, SeverityEntry] = {}
    for k, v in raw.items():
        key = k.decode("utf-8") if isinstance(k, bytes) else k
        val_str = v.decode("utf-8") if isinstance(v, bytes) else v
        try:
            entry = json.loads(val_str)
            if isinstance(entry, dict) and "color" in entry and "sensitivity_level" in entry:
                out[key] = entry
            else:
                out[key] = _legacy_entry(key, val_str)
        except json.JSONDecodeError:
            out[key] = _legacy_entry(key, val_str)
    return out


def _legacy_entry(attr: str, color: str) -> SeverityEntry:
    """Convert legacy stored value (plain color string) to SeverityEntry using defaults."""
    default = DEFAULT_ATTRIBUTE_SEVERITY.get(attr, {"color": "green", "sensitivity_level": 1})
    return {"color": color if color in ("red", "yellow", "green") else default["color"], "sensitivity_level": default["sensitivity_level"]}


def set_attribute_severity_map(mapping: dict[str, SeverityEntry]) -> None:
    """Store the attribute -> {color, sensitivity_level} map in Valkey (HSET, JSON value). No TTL."""
    client = get_client()
    client.delete(SEVERITY_KEY)
    if not mapping:
        return
    payload: dict[str, str] = {}
    for attr, entry in mapping.items():
        if isinstance(entry, dict) and "color" in entry and "sensitivity_level" in entry:
            payload[attr] = json.dumps(entry)
        else:
            payload[attr] = json.dumps({"color": "green", "sensitivity_level": 1})
    client.hset(SEVERITY_KEY, mapping=payload)


# ---------------------------------------------------------------------------
# Per-site attribute ZSET helpers
# ---------------------------------------------------------------------------

def _site_key(domain: str) -> str:
    return f"{SITE_ATTRS_PREFIX}{domain}"


def set_site_attributes(domain: str, attributes: list[str]) -> None:
    """
    Store the list of attributes found for *domain* in a ZSET scored by sensitivity_level.

    Looks up each attribute's sensitivity_level from the global severity map in Valkey.
    Higher score = higher sensitivity = first in sort order. No TTL.
    """
    severity_map = get_attribute_severity_map()
    if not severity_map:
        logger.warning("Severity map is empty; falling back to defaults for scoring")
        severity_map = DEFAULT_ATTRIBUTE_SEVERITY.copy()

    key = _site_key(domain)
    client = get_client()
    client.delete(key)

    if not attributes:
        return

    scored: dict[str, float] = {}
    for attr in attributes:
        entry = severity_map.get(attr) or DEFAULT_ATTRIBUTE_SEVERITY.get(attr)
        level = int(entry["sensitivity_level"]) if isinstance(entry, dict) and "sensitivity_level" in entry else 1
        scored[attr] = float(level)

    client.zadd(key, scored)
    logger.info("Stored %d attributes for domain %s", len(scored), domain)


def get_site_attributes(domain: str) -> list[dict[str, Any]]:
    """
    Return attributes found for *domain*, sorted by sensitivity_level (highest first).

    Each item: {"attribute": str, "color": str, "sensitivity_level": int}.
    Returns an empty list if no data exists for the domain.
    """
    key = _site_key(domain)
    client = get_client()
    raw = client.zrevrange(key, 0, -1, withscores=True)
    if not raw:
        return []

    severity_map = get_attribute_severity_map()
    if not severity_map:
        severity_map = {k: v for k, v in DEFAULT_ATTRIBUTE_SEVERITY.items()}

    result: list[dict[str, Any]] = []
    for member, score in raw:
        attr = member.decode("utf-8") if isinstance(member, bytes) else member
        entry = severity_map.get(attr) or DEFAULT_ATTRIBUTE_SEVERITY.get(attr)
        color = entry.get("color", "green") if isinstance(entry, dict) else "green"
        result.append({
            "attribute": attr,
            "color": color,
            "sensitivity_level": int(score),
        })
    return result


# ---------------------------------------------------------------------------
# Extract attribute names from a data_collection dict
# ---------------------------------------------------------------------------

def collect_attributes_from_data_collection(data_collection: dict[str, Any]) -> list[str]:
    """
    Given the ``data_collection`` section of a ``PolicyAnalysis`` dict, return a
    de-duplicated list of attribute name strings found in the extraction.

    Handles both ``types``-style sub-objects and ``Signal``-style (ip_address).
    """
    attrs: set[str] = set()

    # Sub-sections that have a "types" list
    for section_key in (
        "personal_identifiers",
        "precise_location",
        "device_fingerprinting",
        "user_content",
        "third_party_data",
        "sensitive_data",
        "children_data",
    ):
        section = data_collection.get(section_key)
        if section and isinstance(section, dict):
            for t in section.get("types", []):
                if isinstance(t, str):
                    attrs.add(t)

    # ip_address is a Signal; include if status indicates collection
    ip_signal = data_collection.get("ip_address")
    if isinstance(ip_signal, dict) and ip_signal.get("status") in ("true", "True", True):
        attrs.add("ip_address")

    return sorted(attrs)
