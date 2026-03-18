from __future__ import annotations

from copy import deepcopy
from typing import Any


def _to_bytes(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    return str(value).encode("utf-8")


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.expiry: dict[str, int] = {}
        self.hashes: dict[str, dict[bytes, bytes]] = {}
        self.sorted_sets: dict[str, dict[bytes, float]] = {}
        self.closed = False

    def set(self, key: str, value: bytes | str, ex: int | None = None) -> None:
        self.values[key] = _to_bytes(value)
        if ex is not None:
            self.expiry[key] = ex

    def get(self, key: str) -> bytes | None:
        return self.values.get(key)

    def delete(self, *keys: str) -> int:
        deleted = 0
        for key in keys:
            existed = False
            if key in self.values:
                del self.values[key]
                self.expiry.pop(key, None)
                existed = True
            if key in self.hashes:
                del self.hashes[key]
                existed = True
            if key in self.sorted_sets:
                del self.sorted_sets[key]
                existed = True
            deleted += int(existed)
        return deleted

    def exists(self, *keys: str) -> int:
        return sum(
            1
            for key in keys
            if key in self.values or key in self.hashes or key in self.sorted_sets
        )

    def hset(self, key: str, mapping: dict[str, str]) -> None:
        bucket = self.hashes.setdefault(key, {})
        for field, value in mapping.items():
            bucket[_to_bytes(field)] = _to_bytes(value)

    def hgetall(self, key: str) -> dict[bytes, bytes]:
        return deepcopy(self.hashes.get(key, {}))

    def zadd(self, key: str, mapping: dict[str, float]) -> None:
        bucket = self.sorted_sets.setdefault(key, {})
        for member, score in mapping.items():
            bucket[_to_bytes(member)] = float(score)

    def zrevrange(
        self, key: str, start: int, end: int, withscores: bool = False
    ) -> list[Any]:
        items = sorted(
            self.sorted_sets.get(key, {}).items(),
            key=lambda item: (item[1], item[0]),
            reverse=True,
        )
        if end == -1:
            selected = items[start:]
        else:
            selected = items[start : end + 1]
        if withscores:
            return selected
        return [member for member, _ in selected]

    def close(self) -> None:
        self.closed = True


class DummyCachedModel:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = deepcopy(payload)

    def model_dump(self) -> dict[str, Any]:
        return deepcopy(self.payload)


def sample_analysis_payload() -> dict[str, Any]:
    return {
        "data_collection": {
            "personal_identifiers": {
                "types": ["government_id", "email"],
                "evidence": "We collect government ID and email.",
                "explanation": "Identity data can be highly sensitive.",
                "mitigation": "Avoid uploading unnecessary identity documents.",
            },
            "ip_address": {
                "status": "true",
                "evidence": "We log your IP address.",
                "explanation": "IP logs can reveal network and location patterns.",
                "mitigation": "Use a privacy-preserving network where appropriate.",
            },
            "precise_location": {
                "types": ["precise_gps"],
                "evidence": "We collect precise GPS coordinates.",
                "explanation": "Precise location exposes real-world movements.",
                "mitigation": "Disable location access unless it is essential.",
            },
            "device_fingerprinting": {
                "types": ["fingerprint"],
                "evidence": "We derive a device fingerprint.",
                "explanation": "Fingerprinting can enable persistent tracking.",
                "mitigation": "Use privacy browser protections to reduce tracking.",
            },
            "user_content": {
                "types": ["messages"],
                "evidence": "We process your messages.",
                "explanation": "Messages may include highly personal information.",
                "mitigation": "Avoid sending sensitive content through the service.",
            },
            "third_party_data": {
                "types": ["advertisers"],
                "evidence": "We receive data from advertisers.",
                "explanation": "Third-party feeds expand the data profile.",
                "mitigation": "Limit ad personalization and linked accounts.",
            },
            "sensitive_data": {
                "types": ["health"],
                "evidence": "We infer health-related information.",
                "explanation": "Health data is especially sensitive.",
                "mitigation": "Keep health-related activity off the platform.",
            },
        },
        "retention": {
            "retention_duration": "indefinite",
            "retention_explanation": "Data may be kept until account deletion is requested.",
            "deletion_rights": {
                "status": "true",
                "evidence": "You may request deletion.",
            },
            "vague_retention_language": {
                "status": "false",
                "evidence": "We specify the retention window.",
            },
        },
    }
