"""TOS processor routes."""

import asyncio
import logging

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse

from app.api.tos_processor.chain import _extract_terms_and_privacy_risks
from app.api.tos_processor.models import PolicyAnalysis
from app.queries import get_json, set_json
from app.severity_store import collect_attributes_from_data_collection, set_site_attributes
from app.utils.fetch_page import fetch_page_content
from app.utils.url_utils import get_domain

router = APIRouter(prefix="/tos_processor", tags=["tos_processor"])
logger = logging.getLogger(__name__)

TOS_CACHE_PREFIX = "tos:process:"

# In-memory store for the last POST result; GET returns this.
_fetched_pages: dict[str, str] = {}


def _cache_key_for_urls(urls: list[str]) -> str:
    """Cache key from domain name(s) extracted from the URLs."""
    domains = sorted({get_domain(u) for u in urls if u.strip()})
    key = "|".join(domains) if domains else "no_domain"
    return f"{TOS_CACHE_PREFIX}{key}"


def _policies_with_headings(pages: dict[str, str]) -> list[str]:
    """Format url -> text as list of strings: each item is heading (URL) followed by content."""
    return [f"Source: {url}\n\n{text.strip()}" for url, text in pages.items()]


async def _run_process_and_cache(urls: list[str]) -> None:
    """Fetch pages, run extraction, and store result in Valkey. Runs in background."""
    try:
        result: dict[str, str] = {}
        for u in urls:
            try:
                text = await fetch_page_content(u)
                result[u] = text
            except Exception as e:
                logger.exception("Failed to fetch %s: %s", u, e)
                return
        policies = _policies_with_headings(result)
        extraction = await asyncio.to_thread(_extract_terms_and_privacy_risks, policies)
        cache_key = _cache_key_for_urls(urls)
        set_json(cache_key, extraction)
        logger.info("Cached TOS analysis for %d URLs under key %s", len(urls), cache_key)

        # Store per-domain attributes sorted by severity in Valkey (ZSET)
        data_collection = extraction.get("data_collection", {})
        found_attrs = collect_attributes_from_data_collection(data_collection)
        domains = {get_domain(u) for u in urls if u.strip()}
        for domain in domains:
            set_site_attributes(domain, found_attrs)
        logger.info("Stored %d attributes for %d domain(s)", len(found_attrs), len(domains))
    except Exception as e:
        logger.exception("Background TOS process failed: %s", e)


@router.get("/")
def tos_processor_get() -> dict[str, str]:
    """Return the dictionary of url -> page text from the last successful POST."""
    return _fetched_pages


@router.get("/process")
async def tos_processor_get_process(
    url: list[str] = Query(..., description="URLs to fetch and analyze")
) -> dict:
    """
    Return cached analysis if available. Otherwise start processing in the background
    and return 202; call again with the same URLs to get the result once ready.
    """
    urls = list(url)
    if not urls:
        raise HTTPException(status_code=400, detail="At least one url is required")
    cache_key = _cache_key_for_urls(urls)
    try:
        cached = get_json(cache_key, PolicyAnalysis)
    except Exception as e:
        logger.warning("Cache lookup failed: %s", e)
        cached = None
    if cached is not None:
        return cached.model_dump()
    asyncio.create_task(_run_process_and_cache(urls))
    return JSONResponse(
        status_code=202,
        content={
            "status": "processing",
            "message": "Analysis started in background. Call this endpoint again with the same URLs to retrieve the result.",
        },
    )


@router.post("/")
async def tos_processor_root(
    urls: list[str] = Body(..., description="List of URLs to fetch")
) -> dict:
    """
    Return cached analysis if available. Otherwise start processing in the background
    and return 202; call again with the same URLs to get the result once ready.
    """
    if not urls:
        raise HTTPException(status_code=400, detail="At least one URL is required")
    cache_key = _cache_key_for_urls(urls)
    try:
        cached = get_json(cache_key, PolicyAnalysis)
    except Exception as e:
        logger.warning("Cache lookup failed: %s", e)
        cached = None
    if cached is not None:
        return cached.model_dump()
    asyncio.create_task(_run_process_and_cache(urls))
    return JSONResponse(
        status_code=202,
        content={
            "status": "processing",
            "message": "Analysis started in background. Call this endpoint again with the same URLs to retrieve the result.",
        },
    )

