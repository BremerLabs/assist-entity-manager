"""Regression checks for AEM frontend refresh and localization guards."""
from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
LOADER = ROOT / "custom_components" / "assist_entity_manager" / "frontend" / "assist-entity-manager.js"
RUNTIME_FIXES = ROOT / "custom_components" / "assist_entity_manager" / "frontend" / "aem-runtime-fixes.js"


class FrontendLoaderRegressionTests(unittest.TestCase):
    """Keep the refresh bridge and runtime compatibility guards in place."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.loader_source = LOADER.read_text(encoding="utf-8")
        cls.runtime_source = RUNTIME_FIXES.read_text(encoding="utf-8")

    def test_registry_changes_schedule_refresh(self) -> None:
        for event_type in (
            "entity_registry_updated",
            "device_registry_updated",
            "area_registry_updated",
        ):
            self.assertIn(f'register("{event_type}"', self.loader_source)
        self.assertIn("this._scheduleDataRefresh()", self.loader_source)

    def test_entity_creation_and_removal_refresh_from_state_events(self) -> None:
        self.assertIn('register("state_changed"', self.loader_source)
        self.assertIn("data.old_state == null || data.new_state == null", self.loader_source)

    def test_refresh_reloads_alias_index_too(self) -> None:
        self.assertIn("inner._loaded = false", self.loader_source)
        self.assertIn("inner._aliasIndexReady = false", self.loader_source)
        self.assertIn("inner._load?.()", self.loader_source)

    def test_orphaned_registry_entries_are_filtered_by_current_states(self) -> None:
        self.assertIn("function filterOrphanedEntities(instance)", self.runtime_source)
        self.assertIn("hasCurrentState(instance, entity.entityId)", self.runtime_source)
        self.assertIn("proto._processExternalChanges = function", self.runtime_source)

    def test_orphan_filter_applies_to_both_language_bundles(self) -> None:
        self.assertIn('installEntityPresenceGuard("assist-entity-manager-de")', self.runtime_source)
        self.assertIn('installEntityPresenceGuard("assist-entity-manager-en")', self.runtime_source)

    def test_english_fallback_contains_reported_translation_fixes(self) -> None:
        expected = (
            "HOME ASSISTANT VOICE ASSISTANTS",
            "Excluded:",
            "Lock",
            "Water",
            "Warns about very generic spoken names",
            "Home Assistant now reports this entity as not supported.",
        )
        combined = self.loader_source + self.runtime_source
        for text in expected:
            self.assertIn(text, combined)

    def test_runtime_fix_version_matches_patch_release(self) -> None:
        self.assertIn('AEM_RUNTIME_FIX_VERSION = "1.1.2"', self.runtime_source)


if __name__ == "__main__":
    unittest.main()
