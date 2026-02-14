"""Valkey (Redis-compatible) connection and session management."""

from redis import Redis

from app.core.config import get_settings

_SESSION_PREFIX = "session:"
_client: Redis | None = None


def connect() -> None:
    """Create and store the Valkey connection (call on app startup)."""
    global _client
    settings = get_settings()
    _client = Redis(
        host=settings.valkey_host,
        port=settings.valkey_port,
        password=settings.valkey_password or None,
        decode_responses=False,
    )


def close() -> None:
    """Close the Valkey connection (call on app shutdown)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None


def get_client() -> Redis:
    """Return the shared Valkey client. Call connect() before first use."""
    if _client is None:
        raise RuntimeError("Valkey not connected; call db.connect() first.")
    return _client


# --- Session helpers (key-value with optional TTL) ---


def _session_key(key: str) -> str:
    return f"{_SESSION_PREFIX}{key}"


def set_session(
    key: str,
    value: str | bytes,
    ttl_seconds: int | None = None,
) -> None:
    """Store a session value. Optionally set TTL in seconds."""
    client = get_client()
    k = _session_key(key)
    if isinstance(value, str):
        value = value.encode("utf-8")
    client.set(k, value, ex=ttl_seconds)


def get_session(key: str) -> bytes | None:
    """Return raw session bytes, or None if missing."""
    client = get_client()
    return client.get(_session_key(key))


def get_session_str(key: str) -> str | None:
    """Return session value as string, or None if missing."""
    raw = get_session(key)
    return raw.decode("utf-8") if raw is not None else None


def delete_session(key: str) -> None:
    """Remove a session key."""
    get_client().delete(_session_key(key))


def session_exists(key: str) -> bool:
    """Return True if the session key exists."""
    return get_client().exists(_session_key(key)) > 0
