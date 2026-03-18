from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app import db
from tests.fakes import FakeRedis


class DbTests(unittest.TestCase):
    def tearDown(self) -> None:
        db._client = None

    def test_connect_uses_settings_and_close_resets_client(self) -> None:
        fake_client = FakeRedis()
        settings = SimpleNamespace(
            valkey_host="127.0.0.1", valkey_port=6380, valkey_password="secret"
        )

        with patch("app.db.get_settings", return_value=settings), patch(
            "app.db.Redis", return_value=fake_client
        ) as redis_cls:
            db.connect()

            redis_cls.assert_called_once_with(
                host="127.0.0.1",
                port=6380,
                password="secret",
                decode_responses=False,
            )
            self.assertIs(db.get_client(), fake_client)

            db.close()

        self.assertTrue(fake_client.closed)
        self.assertIsNone(db._client)

    def test_get_client_requires_connect(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Valkey not connected"):
            db.get_client()

    def test_session_helpers_round_trip(self) -> None:
        fake_client = FakeRedis()
        db._client = fake_client

        db.set_session("token", "abc123", ttl_seconds=60)

        self.assertEqual(fake_client.values["session:token"], b"abc123")
        self.assertEqual(fake_client.expiry["session:token"], 60)
        self.assertEqual(db.get_session("token"), b"abc123")
        self.assertEqual(db.get_session_str("token"), "abc123")
        self.assertTrue(db.session_exists("token"))

        db.delete_session("token")

        self.assertFalse(db.session_exists("token"))
        self.assertIsNone(db.get_session("token"))
