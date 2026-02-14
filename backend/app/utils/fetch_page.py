"""Utility to download a page by URL and extract its text content."""

import logging
import re

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)


def html_to_text(html: str) -> str:
    """
    Extract plain text from HTML: strip tags and normalize whitespace.
    Removes script, style, and other non-visible elements.
    """
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript", "iframe", "svg"]):
        tag.decompose()

    text = soup.get_text(separator=" ", strip=True)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


async def fetch_page_content(url: str, *, use_browser: bool = True) -> str:
    """
    Download the page at the given URL, extract text (no HTML tags), and log it at INFO.

    If use_browser is True (default), uses a headless Chromium browser so JavaScript-
    rendered content (e.g. Facebook, SPAs) is included. Otherwise uses a plain HTTP request.

    Raises httpx.HTTPError on HTTP errors when use_browser is False.
    Raises playwright-specific errors when use_browser is True.
    """
    if use_browser:
        raw = await _fetch_with_browser(url)
    else:
        raw = await _fetch_with_httpx(url)

    text = html_to_text(raw)
    logger.info("%s", text)
    return text


async def _fetch_with_httpx(url: str) -> str:
    async with httpx.AsyncClient(follow_redirects=True, verify=False) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


async def _fetch_with_browser(url: str) -> str:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                logger.debug("networkidle timed out for %s, proceeding with current content", url)
            content = await page.content()
            return content
        finally:
            await browser.close()
