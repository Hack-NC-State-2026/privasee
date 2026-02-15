"""API to seed/read the attribute severity map and per-site attributes (Valkey)."""

from fastapi import APIRouter, HTTPException

from app.severity_store import (
    DEFAULT_ATTRIBUTE_SEVERITY,
    get_attribute_severity_map,
    get_site_attributes,
    set_attribute_severity_map,
)

router = APIRouter(prefix="/attribute_severity", tags=["attribute_severity"])


@router.post("/seed")
def seed_attribute_severity() -> dict[str, dict]:
    """
    Seed the attribute -> {color, sensitivity_level} map in Valkey (permanent, no TTL).
    Idempotent: overwrites any existing map with the default 50 attributes.
    """
    try:
        set_attribute_severity_map(DEFAULT_ATTRIBUTE_SEVERITY)
        return get_attribute_severity_map()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.get("/")
def get_attribute_severity() -> dict[str, dict]:
    """Return the current attribute -> {color, sensitivity_level} map from Valkey."""
    try:
        return get_attribute_severity_map()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.get("/sites/{domain}/attributes")
def get_site_attributes_by_severity(domain: str) -> list[dict]:
    """
    Return attributes found for *domain*, sorted by sensitivity_level (highest first).

    Each item: {"attribute": str, "color": str, "sensitivity_level": int}.
    Empty list if no data has been stored for the domain yet.
    """
    try:
        return get_site_attributes(domain)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
