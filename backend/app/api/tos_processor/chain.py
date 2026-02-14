"""LangChain chain for TOS/Privacy Policy extraction using structured output."""

import logging

from langchain_core.tools import StructuredTool
from langchain_google_genai import ChatGoogleGenerativeAI

from app.api.tos_processor.models import PolicyAnalysis
from app.api.tos_processor.prompts import TOS_PRIVACY_EXTRACTION_PROMPT
from app.core.config import get_settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3


def _format_policies(policy_texts: list[str]) -> str:
    """Format multiple policy texts with clear labels for the prompt."""
    if not policy_texts:
        return "(No documents provided.)"
    parts = []
    for i, text in enumerate(policy_texts, start=1):
        label = f"--- Document {i} ---"
        parts.append(f"{label}\n{text.strip()}")
    return "\n\n".join(parts)


def _extract_terms_and_privacy_risks(policy_texts: list[str]) -> dict:
    """
    Run the extraction prompt against the LLM with structured output enforcement.
    Accepts one or more policy/document texts; the LLM extracts from all into one output.
    Retries up to MAX_RETRIES times if the model returns None.
    """
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY is not set")

    policies_block = _format_policies(policy_texts)
    prompt = TOS_PRIVACY_EXTRACTION_PROMPT.format(policies=policies_block)

    model = ChatGoogleGenerativeAI(
        model="gemini-2.5-pro",
        google_api_key=settings.gemini_api_key,
        temperature=0,
    )

    structured_model = model.with_structured_output(PolicyAnalysis, include_raw=True)

    for attempt in range(1, MAX_RETRIES + 1):
        logger.info("LLM extraction attempt %d/%d", attempt, MAX_RETRIES)
        response = structured_model.invoke(prompt)
        parsed = response.get("parsed") if isinstance(response, dict) else response
        if parsed is not None:
            logger.info("Extraction result:\n%s", parsed.model_dump_json(indent=2))
            return parsed.model_dump()
        raw = response.get("raw") if isinstance(response, dict) else None
        logger.warning(
            "LLM returned None on attempt %d/%d. Raw response: %s",
            attempt, MAX_RETRIES, raw,
        )

    raise RuntimeError("LLM failed to return structured output after %d attempts" % MAX_RETRIES)


# LangChain-compatible tool: use with bind_tools([...]) or agent
extract_terms_and_privacy_risks_tool = StructuredTool.from_function(
    name="extract_terms_and_privacy_risks",
    description=(
        "Extract legal and privacy risk signals from one or more Privacy Policy and/or "
        "Terms of Service documents. Input is a list of full plain-text documents; "
        "all are analyzed together into one structured output. "
        "Returns structured JSON: document_metadata, data_collection, data_usage, "
        "data_retention, legal_terms, red_flags."
    ),
    func=_extract_terms_and_privacy_risks,
)
