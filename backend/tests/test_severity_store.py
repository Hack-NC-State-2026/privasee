from __future__ import annotations

import unittest
from unittest.mock import patch

from app import severity_store
from tests.fakes import FakeRedis


class SeverityStoreTests(unittest.TestCase):
    def test_attribute_severity_round_trip(self) -> None:
        fake_client = FakeRedis()
        mapping = {
            "email": {"color": "yellow", "sensitivity_level": 4},
            "government_id": {"color": "red", "sensitivity_level": 9},
        }

        with patch("app.severity_store.get_client", return_value=fake_client):
            severity_store.set_attribute_severity_map(mapping)
            result = severity_store.get_attribute_severity_map()

        self.assertEqual(result, mapping)

    def test_get_attribute_severity_map_normalizes_legacy_values(self) -> None:
        fake_client = FakeRedis()
        fake_client.hashes[severity_store.SEVERITY_KEY] = {
            b"email": b"yellow",
            b"custom_field": b"unknown-color",
        }

        with patch("app.severity_store.get_client", return_value=fake_client):
            result = severity_store.get_attribute_severity_map()

        self.assertEqual(result["email"]["color"], "yellow")
        self.assertEqual(result["email"]["sensitivity_level"], 4)
        self.assertEqual(result["custom_field"]["color"], "green")
        self.assertEqual(result["custom_field"]["sensitivity_level"], 1)

    def test_set_site_attributes_uses_default_severity_and_sorts_highest_first(
        self,
    ) -> None:
        fake_client = FakeRedis()

        with patch("app.severity_store.get_client", return_value=fake_client):
            severity_store.set_site_attributes(
                "example.com", ["analytics", "email", "government_id"]
            )
            result = severity_store.get_site_attributes("example.com")

        self.assertEqual(
            [item["attribute"] for item in result],
            ["government_id", "email", "analytics"],
        )
        self.assertEqual(result[0]["color"], "red")
        self.assertEqual(result[1]["color"], "yellow")
        self.assertEqual(result[2]["color"], "green")

    def test_collect_attributes_from_data_collection_extracts_types_and_ip(self) -> None:
        data_collection = {
            "personal_identifiers": {"types": ["email", "name"]},
            "user_content": {"types": ["messages"]},
            "ip_address": {"status": "true"},
        }

        result = severity_store.collect_attributes_from_data_collection(
            data_collection
        )

        self.assertEqual(result, ["email", "ip_address", "messages", "name"])
