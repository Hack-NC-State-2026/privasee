"""Key-value queries: set and get JSON by key (Valkey-backed), with Pydantic support."""

import json
from typing import Any, TypeVar

from pydantic import BaseModel

from app.db import get_client

T = TypeVar("T", bound=BaseModel)


def set_json(key: str, value: BaseModel | Any, *, ttl_seconds: int | None = None) -> None:
    """
    Store a value under the given key as JSON.
    Accepts a Pydantic model (serialized via model_dump_json) or any JSON-serializable value.
    """
    client = get_client()
    if isinstance(value, BaseModel):
        payload = value.model_dump_json().encode("utf-8")
    else:
        payload = json.dumps(value).encode("utf-8")
    client.set(key, payload, ex=ttl_seconds)


def get_json(key: str, model: type[T]) -> T | None:
    """
    Retrieve a value by key, parse as JSON, and validate into the given Pydantic model.
    Returns an instance of the model or None if the key is missing.
    """
    client = get_client()
    raw = client.get(key)
    if raw is None:
        return None
    data = json.loads(raw.decode("utf-8"))
    return model.model_validate(data)
