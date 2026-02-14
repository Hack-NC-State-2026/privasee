"""TOS processor routes."""

import asyncio
import logging

from fastapi import APIRouter, Body, HTTPException, Query

from app.api.tos_processor.chain import _extract_terms_and_privacy_risks
from app.utils.fetch_page import fetch_page_content

router = APIRouter(prefix="/tos_processor", tags=["tos_processor"])
logger = logging.getLogger(__name__)

# In-memory store for the last POST result; GET returns this.
_fetched_pages: dict[str, str] = {}


def _policies_with_headings(pages: dict[str, str]) -> list[str]:
    """Format url -> text as list of strings: each item is heading (URL) followed by content."""
    return [f"Source: {url}\n\n{text.strip()}" for url, text in pages.items()]


@router.get("/")
def tos_processor_get() -> dict[str, str]:
    """Return the dictionary of url -> page text from the last successful POST."""
    return _fetched_pages


@router.get("/process")
async def tos_processor_get_process(
    url: list[str] = Query(..., description="URLs to fetch and analyze")
) -> dict:
    """
    Fetch each URL, run the extraction chain on the policy text, and return the result.
    Same behavior as POST / but with URLs passed as query params (e.g. ?url=...&url=...).
    """
    global _fetched_pages
    result: dict[str, str] = {}
    for u in url:
        try:
            text = await fetch_page_content(u)
            result[u] = text
        except Exception as e:
            logger.exception("Failed to fetch %s: %s", u, e)
            raise HTTPException(status_code=422, detail=f"Failed to fetch {u}: {e}") from e
    _fetched_pages = result
    logger.info("Fetched pages: %s", result)

    policies = _policies_with_headings(_fetched_pages)
    extraction = await asyncio.to_thread(_extract_terms_and_privacy_risks, policies)
    return extraction


@router.post("/")
async def tos_processor_root(
    urls: list[str] = Body(..., description="List of URLs to fetch")
) -> dict:
    """
    Fetch each URL one by one, store url -> page text, then run the extraction chain on
    those policies (formatted as heading + content per URL) and return the extraction result.
    """
    global _fetched_pages
    result: dict[str, str] = {}
    for url in urls:
        try:
            text = await fetch_page_content(url)
            result[url] = text
        except Exception as e:
            logger.exception("Failed to fetch %s: %s", url, e)
            raise HTTPException(status_code=422, detail=f"Failed to fetch {url}: {e}") from e
    _fetched_pages = result
    logger.info("Fetched pages: %s", result)

    policies = _policies_with_headings(_fetched_pages)
    extraction = await asyncio.to_thread(_extract_terms_and_privacy_risks, policies)
    return extraction
