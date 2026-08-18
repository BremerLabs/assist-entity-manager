"""Tests for AEM's internal Semantic Control provider boundary.

These tests deliberately use controlled adapters. They do not model or pretend
to implement the future Assist Semantic Control external API.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest

MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "assist_entity_manager"
    / "semantic_provider.py"
)
spec = importlib.util.spec_from_file_location("aem_semantic_provider_test_module", MODULE_PATH)
assert spec and spec.loader
semantic_provider = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = semantic_provider
spec.loader.exec_module(semantic_provider)

SemanticProviderManager = semantic_provider.SemanticProviderManager
SemanticProviderSnapshot = semantic_provider.SemanticProviderSnapshot
SemanticProviderDisabledError = semantic_provider.SemanticProviderDisabledError
AEM_PROVIDER_ADAPTER_API_VERSION = semantic_provider.AEM_PROVIDER_ADAPTER_API_VERSION


class FakeAdapter:
    """Controlled AEM-side adapter test double."""

    aem_adapter_api_version = AEM_PROVIDER_ADAPTER_API_VERSION

    def __init__(self, snapshot=None, error=None):
        self.snapshot = snapshot or SemanticProviderSnapshot(
            state="compatible",
            provider_name="Test provider",
            contract_version="test-contract",
        )
        self.error = error
        self.snapshot_calls = 0
        self.read_calls = 0
        self.write_calls = 0

    async def async_get_snapshot(self):
        self.snapshot_calls += 1
        if self.error:
            raise self.error
        return self.snapshot

    async def async_read_entity_data(self, entity_id):
        self.read_calls += 1
        return {"entity_id": entity_id}

    async def async_write_entity_data(self, entity_id, changes):
        self.write_calls += 1
        return {"entity_id": entity_id, **changes}


class SemanticProviderManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_without_provider_is_safe(self):
        manager = SemanticProviderManager()
        snapshot = await manager.async_get_snapshot(enabled=True)
        self.assertEqual(snapshot.state, "not_available")

    async def test_disabled_never_calls_provider(self):
        manager = SemanticProviderManager()
        adapter = FakeAdapter()
        manager.set_adapter(adapter)

        snapshot = await manager.async_get_snapshot(enabled=False)

        self.assertEqual(snapshot.state, "disabled")
        self.assertEqual(adapter.snapshot_calls, 0)

        with self.assertRaises(SemanticProviderDisabledError):
            await manager.async_read_entity_data("light.demo", enabled=False)
        with self.assertRaises(SemanticProviderDisabledError):
            await manager.async_write_entity_data(
                "light.demo", {"future_field": True}, enabled=False
            )
        self.assertEqual(adapter.read_calls, 0)
        self.assertEqual(adapter.write_calls, 0)

    async def test_compatible_provider_preserves_dynamic_schema(self):
        manager = SemanticProviderManager()
        adapter = FakeAdapter(
            SemanticProviderSnapshot(
                state="compatible",
                provider_name="Test provider",
                contract_version="test-contract",
                capabilities=("known_for_test", "future_unknown_capability"),
                schema={
                    "properties": {
                        "future_unknown_field": {"type": "boolean"},
                    }
                },
            )
        )
        manager.set_adapter(adapter)

        snapshot = await manager.async_get_snapshot(enabled=True)

        self.assertEqual(snapshot.state, "compatible")
        self.assertIn("future_unknown_capability", snapshot.capabilities)
        self.assertIn("future_unknown_field", snapshot.schema["properties"])

    async def test_missing_optional_schema_is_not_fabricated(self):
        manager = SemanticProviderManager()
        manager.set_adapter(
            FakeAdapter(
                SemanticProviderSnapshot(
                    state="compatible",
                    provider_name="Test provider",
                    contract_version="test-contract",
                )
            )
        )

        snapshot = await manager.async_get_snapshot(enabled=True)

        self.assertEqual(snapshot.state, "compatible")
        self.assertIsNone(snapshot.schema)
        self.assertEqual(snapshot.capabilities, ())

    async def test_incompatible_adapter_version_is_rejected_without_call(self):
        manager = SemanticProviderManager()
        adapter = FakeAdapter()
        adapter.aem_adapter_api_version = AEM_PROVIDER_ADAPTER_API_VERSION + 1
        manager.set_adapter(adapter)

        snapshot = await manager.async_get_snapshot(enabled=True)

        self.assertEqual(snapshot.state, "incompatible")
        self.assertEqual(adapter.snapshot_calls, 0)

    async def test_provider_failure_is_contained(self):
        manager = SemanticProviderManager()
        manager.set_adapter(FakeAdapter(error=RuntimeError("temporary failure")))

        snapshot = await manager.async_get_snapshot(enabled=True)

        self.assertEqual(snapshot.state, "unavailable")
        self.assertIn("temporary failure", snapshot.error)

    async def test_unknown_provider_state_is_not_blindly_accepted(self):
        manager = SemanticProviderManager()
        manager.set_adapter(
            FakeAdapter(
                SemanticProviderSnapshot(
                    state="future_state",
                    provider_name="Test provider",
                    contract_version="future-contract",
                )
            )
        )

        snapshot = await manager.async_get_snapshot(enabled=True)

        self.assertEqual(snapshot.state, "incomplete")
        self.assertEqual(snapshot.contract_version, "future-contract")

    async def test_enabled_read_and_write_delegate_only_through_adapter(self):
        manager = SemanticProviderManager()
        adapter = FakeAdapter()
        manager.set_adapter(adapter)

        read_result = await manager.async_read_entity_data(
            "light.demo", enabled=True
        )
        write_result = await manager.async_write_entity_data(
            "light.demo", {"future_field": True}, enabled=True
        )

        self.assertEqual(read_result["entity_id"], "light.demo")
        self.assertTrue(write_result["future_field"])
        self.assertEqual(adapter.read_calls, 1)
        self.assertEqual(adapter.write_calls, 1)


if __name__ == "__main__":
    unittest.main()
