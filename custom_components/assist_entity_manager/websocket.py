"""Assist Entity Manager-owned WebSocket commands."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN
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


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "assist_entity_manager/settings/get"}
)
@websocket_api.async_response
async def websocket_get_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return admin/developer AEM settings and normalized provider status."""
    connection.send_result(msg["id"], await _settings_payload(hass))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/settings/update",
        vol.Required("use_semantic_control_extensions"): bool,
    }
)
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


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/entity/remove_orphan",
        vol.Required("entity_id"): cv.entity_id,
    }
)
@websocket_api.async_response
async def websocket_remove_orphan_entity(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Permanently remove a state-less entity registry entry.

    AEM deliberately refuses to remove an entity that currently has a Home
    Assistant state. Active entities are owned by their source integration,
    YAML configuration or helper implementation and would otherwise be likely
    to re-register themselves. This command is therefore a registry-cleanup
    operation for stale/orphaned entries, not a generic integration remover.
    """
    entity_id = msg["entity_id"]
    registry = er.async_get(hass)
    entry = registry.async_get(entity_id)

    if entry is None:
        connection.send_error(
            msg["id"],
            "entity_not_found",
            "The entity registry entry does not exist.",
        )
        return

    if hass.states.get(entity_id) is not None:
        connection.send_error(
            msg["id"],
            "entity_active",
            (
                "The entity is currently active. Remove or disable its source "
                "integration, YAML definition or helper first. AEM will not "
                "delete an active source-managed entity registry entry."
            ),
        )
        return

    device_id = entry.device_id
    platform = entry.platform
    registry.async_remove(entity_id)

    connection.send_result(
        msg["id"],
        {
            "entity_id": entity_id,
            "removed": True,
            "device_id": device_id,
            "platform": platform,
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/entity/update_assignment",
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("area_id"): vol.Any(str, None),
        vol.Optional("device_id"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def websocket_update_entity_assignment(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Update the HA registry assignment fields AEM exposes in the detail panel."""
    if "area_id" not in msg and "device_id" not in msg:
        connection.send_error(
            msg["id"],
            "missing_assignment",
            "An area_id or device_id must be provided.",
        )
        return

    registry = er.async_get(hass)
    entity_id = msg["entity_id"]
    entry = registry.async_get(entity_id)

    if entry is None:
        connection.send_error(
            msg["id"],
            "entity_not_found",
            "The entity registry entry does not exist.",
        )
        return

    changes: dict[str, Any] = {}

    if "area_id" in msg:
        from homeassistant.helpers import area_registry as ar

        area_id = msg["area_id"]
        if (
            area_id is not None
            and ar.async_get(hass).async_get_area(area_id) is None
        ):
            connection.send_error(
                msg["id"],
                "area_not_found",
                "The area registry entry does not exist.",
            )
            return
        changes["area_id"] = area_id

    if "device_id" in msg:
        from homeassistant.helpers import device_registry as dr

        device_id = msg["device_id"]
        if (
            device_id is not None
            and dr.async_get(hass).async_get(device_id) is None
        ):
            connection.send_error(
                msg["id"],
                "device_not_found",
                "The device registry entry does not exist.",
            )
            return
        changes["device_id"] = device_id

    updated = registry.async_update_entity(entity_id, **changes)
    connection.send_result(msg["id"], updated.extended_dict)


def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register AEM WebSocket commands once per Home Assistant runtime."""
    runtime = _runtime(hass)
    if runtime.get(DATA_WEBSOCKET_REGISTERED):
        return

    websocket_api.async_register_command(hass, websocket_get_settings)
    websocket_api.async_register_command(hass, websocket_update_settings)
    websocket_api.async_register_command(hass, websocket_remove_orphan_entity)
    websocket_api.async_register_command(hass, websocket_update_entity_assignment)
    runtime[DATA_WEBSOCKET_REGISTERED] = True
