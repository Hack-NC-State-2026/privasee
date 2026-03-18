from __future__ import annotations

import importlib
import unittest

tos_router = importlib.import_module("app.api.tos_processor.router")


class TosProcessorRouterTests(unittest.TestCase):
    def test_cache_key_uses_registered_domains(self) -> None:
        with unittest.mock.patch.object(
            tos_router, "get_domain", return_value="google.com"
        ):
            key = tos_router._cache_key_for_urls(
                [
                    "https://policies.google.com/privacy",
                    "https://accounts.google.com/signup",
                ]
            )

        self.assertEqual(key, "tos:process:google.com")

    def test_normalize_domain_input_accepts_urls_and_hosts(self) -> None:
        with unittest.mock.patch.object(
            tos_router,
            "get_domain",
            side_effect=["example.co.uk", "linkedin.com"],
        ):
            self.assertEqual(
                tos_router._normalize_domain_input("https://sub.example.co.uk/path"),
                "example.co.uk",
            )
            self.assertEqual(
                tos_router._normalize_domain_input("www.linkedin.com"),
                "linkedin.com",
            )

    def test_policies_with_headings_formats_source_blocks(self) -> None:
        result = tos_router._policies_with_headings(
            {
                "https://example.com/privacy": "  Privacy text  ",
                "https://example.com/terms": "Terms text",
            }
        )

        self.assertEqual(
            result,
            [
                "Source: https://example.com/privacy\n\nPrivacy text",
                "Source: https://example.com/terms\n\nTerms text",
            ],
        )
