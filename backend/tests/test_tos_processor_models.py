from __future__ import annotations

import unittest

from app.api.tos_processor.models import (
    DeviceDataCollected,
    PersonalIdentifiersCollected,
)


class TosProcessorModelTests(unittest.TestCase):
    def test_personal_identifier_types_drop_invalid_values(self) -> None:
        model = PersonalIdentifiersCollected(
            types=["email", "phone_number", "not_a_real_type"],
            evidence="",
            explanation="",
            mitigation="",
        )

        self.assertEqual(model.types, ["email", "phone_number"])

    def test_device_data_types_drop_invalid_values(self) -> None:
        model = DeviceDataCollected(
            types=["browser_info", "timezone", "bad_value"],
            evidence="",
            explanation="",
            mitigation="",
        )

        self.assertEqual(model.types, ["browser_info", "timezone"])
