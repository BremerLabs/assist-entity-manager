"""Regression checks for AEM v1.2.0 frontend and feature guards."""
from __future__ import annotations

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "assist_entity_manager"
LOADER = COMPONENT / "frontend" / "assist-entity-manager.js"
RUNTIME_FIXES = COMPONENT / "frontend" / "aem-runtime-fixes.js"
GERMAN = COMPONENT / "frontend" / "assist-entity-manager.de.js"
ENGLISH = COMPONENT / "frontend" / "assist-entity-manager.en.js"
ORPHAN_UI = COMPONENT / "frontend" / "aem-orphan-manager.js"
WEBSOCKET = COMPONENT / "websocket.py"
MANUAL_ALEXA = COMPONENT / "manual_alexa.py"
INIT = COMPONENT / "__init__.py"
CONST = COMPONENT / "const.py"
MANIFEST = COMPONENT / "manifest.json"


class FrontendLoaderRegressionTests(unittest.TestCase):
    """Keep the v1.2.0 refresh, localization and new-feature guards in place."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.loader_source = LOADER.read_text(encoding="utf-8")
        cls.runtime_source = RUNTIME_FIXES.read_text(encoding="utf-8")
        cls.german_source = GERMAN.read_text(encoding="utf-8")
        cls.english_source = ENGLISH.read_text(encoding="utf-8")
        cls.orphan_source = ORPHAN_UI.read_text(encoding="utf-8")
        cls.websocket_source = WEBSOCKET.read_text(encoding="utf-8")
        cls.manual_alexa_source = MANUAL_ALEXA.read_text(encoding="utf-8")
        cls.init_source = INIT.read_text(encoding="utf-8")
        cls.const_source = CONST.read_text(encoding="utf-8")
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

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

    def test_release_version_is_consistent(self) -> None:
        self.assertEqual(self.manifest["version"], "1.2.0")
        for source in (
            self.const_source,
            self.loader_source,
            self.runtime_source,
            self.german_source,
            self.english_source,
            self.orphan_source,
        ):
            self.assertIn("1.2.0", source)
            self.assertNotIn("1.2.0-rc", source)

    def test_manual_yaml_alexa_is_marked_beta_in_both_languages(self) -> None:
        self.assertIn("Amazon Alexa (Manuell/YAML) · BETA", self.german_source)
        self.assertIn("Amazon Alexa (Manual/YAML) · BETA", self.english_source)
        self.assertIn("BETA · Durch YAML verwaltet", self.german_source)
        self.assertIn("BETA · Managed by YAML", self.english_source)

    def test_manual_yaml_alexa_uses_home_assistant_runtime_config(self) -> None:
        self.assertIn('assist_entity_manager/alexa_manual/status', self.manual_alexa_source)
        self.assertIn("async_hass_config_yaml", self.manual_alexa_source)
        self.assertIn("async_get_entities", self.manual_alexa_source)
        self.assertIn("AlexaConfig", self.manual_alexa_source)
        self.assertIn("async_register_manual_alexa_websocket_commands", self.init_source)

    def test_orphan_manager_is_marked_beta(self) -> None:
        self.assertIn("Verwaiste Entitäten · BETA", self.orphan_source)
        self.assertIn("Orphaned entities · BETA", self.orphan_source)
        self.assertIn("Broader real-world experience", self.orphan_source)

    def test_orphan_cleanup_requires_explicit_safety_confirmations(self) -> None:
        for text in (
            'confirm_references',
            'confirm_incomplete',
            'confirm_source_active',
            'assist_entity_manager/orphans/preview',
            'assist_entity_manager/orphans/remove',
        ):
            self.assertIn(text, self.websocket_source)
        self.assertIn("AEMOrphanManager", self.init_source)
        self.assertIn("aem-orphan-manager.js", self.init_source)

    def test_entity_area_and_device_assignment_are_available(self) -> None:
        self.assertIn('assist_entity_manager/entity/update_assignment', self.websocket_source)
        self.assertIn('device_id=device_id', self.websocket_source)
        self.assertIn("Bereich der Entität", self.german_source)
        self.assertIn("Entity area", self.english_source)
        self.assertIn("Vom Gerät übernehmen", self.german_source)
        self.assertIn("Use device area", self.english_source)
        self.assertIn("Inherited from device", self.english_source)

    def test_entity_open_button_uses_native_more_info_event(self) -> None:
        self.assertIn('new CustomEvent("hass-more-info"', self.german_source)
        self.assertIn('new CustomEvent("hass-more-info"', self.english_source)

    def test_english_fallback_contains_reported_translation_fixes(self) -> None:
        expected = (
            "HOME ASSISTANT VOICE ASSISTANTS",
            "Excluded:",
            "Lock",
            "Water",
            "Warns about very generic spoken names",
            "Home Assistant now reports this entity as not supported.",
            '"von", "of"',
            '"sichtbar", "visible"',
            '"Sperren", "Block"',
            '"Freigeben", "Expose"',
        )
        combined = self.loader_source + self.runtime_source + self.english_source
        for text in expected:
            self.assertIn(text, combined)

    def test_runtime_fix_version_matches_release(self) -> None:
        self.assertIn('AEM_RUNTIME_FIX_VERSION="1.2.0"', self.runtime_source)


if __name__ == "__main__":
    unittest.main()
