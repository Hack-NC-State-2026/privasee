from __future__ import annotations

from contextlib import contextmanager
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.core.config import get_settings
from tests.fakes import DummyCachedModel, FakeRedis, sample_analysis_payload

import importlib

tos_router_module = importlib.import_module("app.api.tos_processor.router")


@contextmanager
def api_client() -> TestClient:
    os.environ["DEBUG"] = "false"
    os.environ["ENVIRONMENT"] = "development"
    get_settings.cache_clear()
    main_module = importlib.import_module("app.main")

    with patch.object(main_module, "db_connect"), patch.object(
        main_module, "db_close"
    ):
        with TestClient(main_module.create_application()) as client:
            yield client
    tos_router_module._processing_cache_keys.clear()


class ApiRouteTests(unittest.TestCase):
    def test_root_and_health_endpoints(self) -> None:
        with api_client() as client:
            root_response = client.get("/api/")
            health_response = client.get("/api/health")

        self.assertEqual(root_response.status_code, 200)
        self.assertIn("is running", root_response.json()["message"])
        self.assertEqual(
            health_response.json(), {"status": "ok", "environment": "development"}
        )

    def test_kv_endpoint_writes_to_valkey(self) -> None:
        fake_client = FakeRedis()

        with api_client() as client, patch(
            "app.api.kv.get_client", return_value=fake_client
        ):
            response = client.post("/api/kv", json={"key": "hello", "value": "world"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": "true"})
        self.assertEqual(fake_client.values["hello"], b"world")

    def test_fetch_page_endpoint_handles_success_and_failure(self) -> None:
        with api_client() as client, patch(
            "app.api.fetch_page.fetch_page_content",
            new=AsyncMock(return_value="policy text"),
        ):
            success = client.get("/api/fetch_page", params={"url": "https://example.com"})

        self.assertEqual(success.status_code, 200)
        self.assertEqual(success.json()["length"], len("policy text"))

        with api_client() as client, patch(
            "app.api.fetch_page.fetch_page_content",
            new=AsyncMock(side_effect=httpx.HTTPError("boom")),
        ):
            failure = client.get("/api/fetch_page", params={"url": "https://example.com"})

        self.assertEqual(failure.status_code, 422)
        self.assertEqual(failure.json()["detail"], "boom")

    def test_attribute_severity_endpoints(self) -> None:
        seeded = {"email": {"color": "yellow", "sensitivity_level": 4}}
        site_attrs = [{"attribute": "email", "color": "yellow", "sensitivity_level": 4}]

        with api_client() as client, patch(
            "app.api.attribute_severity.set_attribute_severity_map"
        ) as set_map, patch(
            "app.api.attribute_severity.get_attribute_severity_map",
            return_value=seeded,
        ), patch(
            "app.api.attribute_severity.get_site_attributes", return_value=site_attrs
        ):
            seed_response = client.post("/api/attribute_severity/seed")
            read_response = client.get("/api/attribute_severity/")
            site_response = client.get("/api/attribute_severity/sites/example.com/attributes")

        self.assertEqual(seed_response.status_code, 200)
        self.assertEqual(read_response.status_code, 200)
        self.assertEqual(site_response.status_code, 200)
        self.assertEqual(seed_response.json(), seeded)
        self.assertEqual(read_response.json(), seeded)
        self.assertEqual(site_response.json(), site_attrs)
        set_map.assert_called_once()

    def test_overlay_summary_endpoint_surfaces_compute_errors(self) -> None:
        payload = {"domain": "example.com", "top_high_risk_attributes": []}

        with api_client() as client, patch(
            "app.api.overlay_summary.compute_top_risks", return_value=payload
        ):
            success = client.get(
                "/api/overlay_summary/top_risks", params={"domain": "example.com"}
            )

        self.assertEqual(success.status_code, 200)
        self.assertEqual(success.json(), payload)

        with api_client() as client, patch(
            "app.api.overlay_summary.compute_top_risks",
            side_effect=RuntimeError("summary failed"),
        ):
            failure = client.get(
                "/api/overlay_summary/top_risks", params={"domain": "example.com"}
            )

        self.assertEqual(failure.status_code, 503)
        self.assertEqual(failure.json()["detail"], "summary failed")

    def test_tos_processor_cached_endpoint_reports_matches_and_misses(self) -> None:
        cached_model = DummyCachedModel(sample_analysis_payload())

        def fake_get_json(key: str, _model: object) -> DummyCachedModel | None:
            if key == "tos:process:example.com":
                return cached_model
            return None

        with api_client() as client, patch.object(
            tos_router_module, "get_json", side_effect=fake_get_json
        ), patch.object(
            tos_router_module,
            "get_domain",
            side_effect=["example.com", "missing.com", "example.com"],
        ), patch.object(
            tos_router_module,
            "_enrich_with_top_risks",
            side_effect=lambda payload, _urls: {**payload, "overlay_summary": {"ok": True}},
        ):
            response = client.get(
                "/api/tos_processor/cached",
                params=[("domain", "www.example.com"), ("domain", "missing.com")],
            )

        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["matched_count"], 1)
        self.assertEqual(body["missing"], ["missing.com"])
        self.assertIn("example.com", body["matched"])
        self.assertEqual(body["matched"]["example.com"]["overlay_summary"], {"ok": True})

    def test_tos_processor_process_endpoint_returns_processing_and_cached_payload(
        self,
    ) -> None:
        url = "https://example.com/privacy"

        def fake_create_task(coro: object) -> object:
            coro.close()
            return object()

        with api_client() as client, patch.object(
            tos_router_module, "get_json", return_value=None
        ), patch.object(
            tos_router_module, "get_domain", return_value="example.com"
        ), patch.object(
            tos_router_module.asyncio,
            "create_task",
            side_effect=fake_create_task,
        ) as create_task:
            miss_response = client.get("/api/tos_processor/process", params={"url": url})

        self.assertEqual(miss_response.status_code, 202)
        self.assertEqual(miss_response.json()["status"], "processing")
        self.assertEqual(create_task.call_count, 1)

        with api_client() as client, patch.object(
            tos_router_module,
            "get_json",
            return_value=DummyCachedModel({"result": "cached"}),
        ), patch.object(
            tos_router_module, "get_domain", return_value="example.com"
        ), patch.object(
            tos_router_module,
            "_enrich_with_top_risks",
            return_value={"result": "cached", "overlay_summary": {"ok": True}},
        ):
            hit_response = client.get("/api/tos_processor/process", params={"url": url})

        self.assertEqual(hit_response.status_code, 200)
        self.assertEqual(
            hit_response.json(), {"result": "cached", "overlay_summary": {"ok": True}}
        )
