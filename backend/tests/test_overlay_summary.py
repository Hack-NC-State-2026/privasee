from __future__ import annotations

import unittest
from unittest.mock import patch

from app.api import overlay_summary
from tests.fakes import DummyCachedModel, sample_analysis_payload


class OverlaySummaryTests(unittest.TestCase):
    def test_compute_top_risks_deduplicates_sections_and_enriches_output(self) -> None:
        site_attributes = [
            {"attribute": "government_id", "color": "red", "sensitivity_level": 9},
            {"attribute": "email", "color": "red", "sensitivity_level": 4},
            {"attribute": "fingerprint", "color": "red", "sensitivity_level": 13},
            {"attribute": "health", "color": "red", "sensitivity_level": 3},
            {"attribute": "analytics", "color": "green", "sensitivity_level": 1},
        ]

        with patch(
            "app.api.overlay_summary.get_site_attributes", return_value=site_attributes
        ), patch(
            "app.api.overlay_summary.get_json",
            return_value=DummyCachedModel(sample_analysis_payload()),
        ), patch(
            "app.api.overlay_summary.get_domain", return_value="example.com"
        ):
            result = overlay_summary.compute_top_risks(
                "https://www.example.com/signup"
            )

        self.assertEqual(result["domain"], "example.com")
        self.assertTrue(result["has_cached_analysis"])
        self.assertEqual(
            [item["title"] for item in result["top_high_risk_attributes"]],
            ["Government Id", "Fingerprint", "Health"],
        )
        self.assertEqual(
            result["top_high_risk_attributes"][0]["evidence"],
            "We collect government ID and email.",
        )
        self.assertEqual(
            result["data_retention_policy"]["explanation"],
            "Data may be kept until account deletion is requested.",
        )
        self.assertEqual(
            [item["title"] for item in result["mitigations"]],
            ["Government Id", "Fingerprint"],
        )

    def test_compute_top_risks_handles_missing_cache(self) -> None:
        with patch(
            "app.api.overlay_summary.get_site_attributes",
            return_value=[
                {"attribute": "health", "color": "red", "sensitivity_level": 3}
            ],
        ), patch("app.api.overlay_summary.get_json", return_value=None), patch(
            "app.api.overlay_summary.get_domain", return_value="example.co.uk"
        ):
            result = overlay_summary.compute_top_risks("subdomain.example.co.uk")

        self.assertEqual(result["domain"], "example.co.uk")
        self.assertFalse(result["has_cached_analysis"])
        self.assertEqual(
            result["top_high_risk_attributes"][0]["title"], "Health"
        )
        self.assertEqual(result["data_retention_policy"]["explanation"], "")
        self.assertEqual(result["mitigations"][0]["mitigation"], "")
