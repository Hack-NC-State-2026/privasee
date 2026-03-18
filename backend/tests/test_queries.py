from __future__ import annotations

import unittest
from unittest.mock import patch

from app.queries import get_json, set_json
from app.schemas.common import MessageResponse
from tests.fakes import FakeRedis


class QueriesTests(unittest.TestCase):
    def test_set_json_serializes_pydantic_models(self) -> None:
        fake_client = FakeRedis()

        with patch("app.queries.get_client", return_value=fake_client):
            set_json("greeting", MessageResponse(message="hello"))

        self.assertEqual(
            fake_client.values["greeting"], b'{"message":"hello"}'
        )

    def test_set_json_and_get_json_round_trip_plain_dict(self) -> None:
        fake_client = FakeRedis()

        with patch("app.queries.get_client", return_value=fake_client):
            set_json("payload", {"message": "hello"}, ttl_seconds=15)
            model = get_json("payload", MessageResponse)

        self.assertEqual(fake_client.expiry["payload"], 15)
        self.assertIsInstance(model, MessageResponse)
        self.assertEqual(model.message, "hello")

    def test_get_json_returns_none_for_missing_key(self) -> None:
        fake_client = FakeRedis()

        with patch("app.queries.get_client", return_value=fake_client):
            result = get_json("missing", MessageResponse)

        self.assertIsNone(result)
