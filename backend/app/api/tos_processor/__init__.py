"""TOS processor module."""

from app.api.tos_processor.router import router
from app.api.tos_processor.chain import extract_terms_and_privacy_risks_tool

__all__ = ["router", "extract_terms_and_privacy_risks_tool"]
