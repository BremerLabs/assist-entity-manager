"""Regression checks for the common AEM frontend loader."""
from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
LOADER = ROOT / "custom_components" / "assist_entity_manager" / "frontend" / "assist-entity-manager.js"


class FrontendLoaderRegressionTests(unittest.TestCase):
    """Keep the refresh bridge and English fallback guard in place."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.source = LOADER.read_text(encoding="utf-8")

    def test_registry_changes_schedule_refresh(self) -> None:
        for event_type in (
            "entity_registry_updated",
            "device_registry_updated",
            "area_registry_updated",
        ):
            self.assertIn(f'register("{event_type}"', self.source)
        self.assertIn("this._scheduleDataRefresh()", self.source)

    def test_entity_creation_and_removal_refresh_from_state_events(self) -> None:
        self.assertIn('register("state_changed"', self.source)
        self.assertIn("data.old_state == null || data.new_state == null", self.source)

    def test_refresh_reloads_alias_index_too(self) -> None:
        self.assertIn("inner._loaded = false", self.source)
        self.assertIn("inner._aliasIndexReady = false", self.source)
        self.assertIn("inner._load?.()", self.source)

    def test_english_fallback_contains_reported_translation_fixes(self) -> None:
        expected = (
            "HOME ASSISTANT VOICE ASSISTANTS",
            "Back to entity list",
            "Mark as seen",
            "Excluded:",
            "Export configuration",
            "Import configuration",
            "e.g. ceiling light, main light …",
        )
        for text in expected:
            self.assertIn(text, self.source)

    def test_english_cleanup_is_only_enabled_for_english_bundle(self) -> None:
        self.assertIn('if (this._lang !== "en" || !this._inner?.shadowRoot) return;', self.source)


if __name__ == "__main__":
    unittest.main()
