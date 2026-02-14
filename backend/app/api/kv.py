"""Key-value store API (Valkey-backed)."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import get_client

router = APIRouter(tags=["kv"])


class KvSetBody(BaseModel):
    """Request body for setting a key-value pair."""

    key: str = Field(..., min_length=1, description="Key")
    value: str = Field(default="", description="Value")


@router.post("/kv")
def set_kv(body: KvSetBody) -> dict[str, str]:
    """Set a key-value pair in Valkey."""
    try:
        client = get_client()
        client.set(body.key, body.value.encode("utf-8"))
        return {"ok": "true"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
