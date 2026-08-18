"""Assist Entity Manager-owned WebSocket commands."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import DOMAIN
from .semantic_provider import SemanticProviderManager
from .settings import AEMSettingsStore

DATA_SETTINGS = "settings"
DATA_SEMANTIC_PROVIDER = "semantic_provider"
DATA_WEBSOCKET_REGISTERED = "websocket_registered"


def _runtime(hass: HomeAssistant) -> dict[str, Any]:
    """Return initialized AEM runtime data."""
    runtime = hass.data.get(DOMAIN)
    if not isinstance(runtime, dict):
        raise RuntimeError("Assist Entity Manager is not initialized.")
    return runtime


async def _settings_payload(hass: HomeAssistant) -> dict[str, Any]:
    runtime = _runtime(hass)
    settings: AEMSettingsStore = runtime[DATA_SETTINGS]
    provider: SemanticProviderManager = runtime[DATA_SEMANTIC_PROVIDER]
    enabled = settings.use_semantic_control_extensions

    # This is the single place where the admin UI asks for provider status.
    # When disabled, SemanticProviderManager guarantees no adapter call occurs.
    snapshot = await provider.async_get_snapshot(enabled=enabled)

    return {
        "settings": settings.as_dict(),
        "semantic_control": snapshot.as_dict(),
    }


@websocket_api.websocket_command(
    {vol.Required("type"): "assist_entity_manager/settings/get"}
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_get_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return admin/developer AEM settings and normalized provider status."""
    connection.send_result(msg["id"], await _settings_payload(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/settings/update",
        vol.Required("use_semantic_control_extensions"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_update_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update AEM-owned admin/developer settings."""
    runtime = _runtime(hass)
    settings: AEMSettingsStore = runtime[DATA_SETTINGS]

    await settings.async_set_semantic_control_extensions(
        msg["use_semantic_control_extensions"]
    )
    connection.send_result(msg["id"], await _settings_payload(hass))


def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register AEM WebSocket commands once per Home Assistant runtime."""
    runtime = _runtime(hass)
    if runtime.get(DATA_WEBSOCKET_REGISTERED):
        return

    websocket_api.async_register_command(hass, websocket_get_settings)
    websocket_api.async_register_command(hass, websocket_update_settings)
    runtime[DATA_WEBSOCKET_REGISTERED] = True
