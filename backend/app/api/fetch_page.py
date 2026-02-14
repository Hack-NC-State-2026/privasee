"""Fetch a page by URL and log its content."""

import httpx
from fastapi import APIRouter, HTTPException

from app.utils.fetch_page import fetch_page_content

router = APIRouter(tags=["fetch_page"])


@router.get("/fetch_page", summary="Fetch page by URL")
async def fetch_page(url: str) -> dict[str, str | int]:
    """Download the page (headless browser for JS-rendered content) and log its text."""
    try:
        body = await fetch_page_content(url)
    except (httpx.HTTPError, Exception) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    return {"status": "ok", "url": url, "length": len(body)}
