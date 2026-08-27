"""Assist Entity Manager-owned WebSocket commands."""
from __future__ import annotations
from typing import Any
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
)

from .const import DOMAIN
from .orphans import AEMOrphanManager, DATA_ORPHAN_MANAGER, OrphanCleanupError
from .semantic_provider import SemanticProviderManager
from .settings import (
    AEMSettingsStore,
    MIN_ORPHAN_CANDIDATE_DAYS,
)

DATA_SETTINGS = "settings"
DATA_SEMANTIC_PROVIDER = "semantic_provider"
DATA_WEBSOCKET_REGISTERED = "websocket_registered"


def _runtime(hass: HomeAssistant) -> dict[str, Any]:
    runtime = hass.data.get(DOMAIN)
    if not isinstance(runtime, dict):
        raise RuntimeError("Assist Entity Manager is not initialized.")
    return runtime


def _orphan_manager(hass: HomeAssistant) -> AEMOrphanManager:
    manager = _runtime(hass).get(DATA_ORPHAN_MANAGER)
    if not isinstance(manager, AEMOrphanManager):
        raise RuntimeError("Assist Entity Manager orphan manager is not initialized.")
    return manager


async def _settings_payload(hass: HomeAssistant) -> dict[str, Any]:
    runtime = _runtime(hass)
    settings: AEMSettingsStore = runtime[DATA_SETTINGS]
    provider: SemanticProviderManager = runtime[DATA_SEMANTIC_PROVIDER]
    snapshot = await provider.async_get_snapshot(
        enabled=settings.use_semantic_control_extensions
    )
    return {"settings": settings.as_dict(), "semantic_control": snapshot.as_dict()}


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "assist_entity_manager/settings/get"}
)
@websocket_api.async_response
async def websocket_get_settings(hass, connection, msg):
    connection.send_result(msg["id"], await _settings_payload(hass))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/settings/update",
        vol.Required("use_semantic_control_extensions"): bool,
    }
)
@websocket_api.async_response
async def websocket_update_settings(hass, connection, msg):
    runtime = _runtime(hass)
    settings: AEMSettingsStore = runtime[DATA_SETTINGS]
    await settings.async_set_semantic_control_extensions(
        msg["use_semantic_control_extensions"]
    )
    connection.send_result(msg["id"], await _settings_payload(hass))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "assist_entity_manager/orphans/list"}
)
@websocket_api.async_response
async def websocket_orphans_list(hass, connection, msg):
    connection.send_result(msg["id"], _orphan_manager(hass).list_payload())


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/orphans/settings/update",
        vol.Required("candidate_after_days"): vol.All(
            int, vol.Range(min=MIN_ORPHAN_CANDIDATE_DAYS)
        ),
    }
)
@websocket_api.async_response
async def websocket_orphans_update_settings(hass, connection, msg):
    runtime = _runtime(hass)
    settings: AEMSettingsStore = runtime[DATA_SETTINGS]
    await settings.async_set_orphan_candidate_days(msg["candidate_after_days"])
    manager = _orphan_manager(hass)
    manager.async_reconcile_all()
    connection.send_result(msg["id"], manager.list_payload())


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/orphans/preview",
        vol.Required("entity_id"): cv.entity_id,
    }
)
@websocket_api.async_response
async def websocket_orphans_preview(hass, connection, msg):
    connection.send_result(
        msg["id"],
        await _orphan_manager(hass).async_preview(msg["entity_id"]),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/orphans/protect",
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("protected"): bool,
    }
)
@websocket_api.async_response
async def websocket_orphans_protect(hass, connection, msg):
    try:
        result = await _orphan_manager(hass).async_set_protected(
            msg["entity_id"], msg["protected"]
        )
    except OrphanCleanupError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/orphans/remove",
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("confirm_references", default=False): bool,
        vol.Optional("confirm_incomplete", default=False): bool,
        vol.Optional("confirm_source_active", default=False): bool,
    }
)
@websocket_api.async_response
async def websocket_orphans_remove(hass, connection, msg):
    try:
        result = await _orphan_manager(hass).async_remove(
            msg["entity_id"],
            confirm_references=msg["confirm_references"],
            confirm_incomplete=msg["confirm_incomplete"],
            confirm_source_active=msg["confirm_source_active"],
        )
    except OrphanCleanupError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/entity/remove_orphan",
        vol.Required("entity_id"): cv.entity_id,
    }
)
@websocket_api.async_response
async def websocket_remove_orphan_entity(hass, connection, msg):
    """Compatibility command from older AEM builds.

    It now delegates to the new safety model and therefore only succeeds without
    extra flags for a freshly verified, unreferenced, strongly orphaned candidate.
    """
    try:
        result = await _orphan_manager(hass).async_remove(
            msg["entity_id"],
            confirm_references=False,
            confirm_incomplete=False,
            confirm_source_active=False,
        )
    except OrphanCleanupError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)



@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/entity/update_assignment",
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("device_id"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def websocket_update_entity_assignment(hass, connection, msg):
    """Update an entity's device registry assignment.

    Area overrides are deliberately not changed here. If an entity has no
    explicit area override, Home Assistant will continue to derive its effective
    area from the assigned device.
    """
    registry = er.async_get(hass)
    entity_id = msg["entity_id"]
    entry = registry.async_get(entity_id)
    if entry is None:
        connection.send_error(
            msg["id"], "entity_not_found", "The entity registry entry does not exist."
        )
        return

    device_id = msg["device_id"]
    if device_id is not None:
        device = dr.async_get(hass).async_get(device_id)
        if device is None:
            connection.send_error(
                msg["id"], "device_not_found", "The device registry entry does not exist."
            )
            return

        # Do not allow AEM to move an entity across integration/config-entry
        # ownership boundaries. Home Assistant does not expose device_id through
        # its public entity-registry update command, so AEM keeps this extension
        # deliberately conservative.
        if entry.config_entry_id != device.config_entry_id:
            connection.send_error(
                msg["id"],
                "incompatible_device",
                "The entity and target device belong to different Home Assistant config entries.",
            )
            return

    try:
        updated = registry.async_update_entity(entity_id, device_id=device_id)
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_assignment", str(err))
        return

    connection.send_result(msg["id"], updated.extended_dict)

def async_register_websocket_commands(hass: HomeAssistant) -> None:
    runtime = _runtime(hass)
    if runtime.get(DATA_WEBSOCKET_REGISTERED):
        return
    websocket_api.async_register_command(hass, websocket_get_settings)
    websocket_api.async_register_command(hass, websocket_update_settings)
    websocket_api.async_register_command(hass, websocket_orphans_list)
    websocket_api.async_register_command(hass, websocket_orphans_update_settings)
    websocket_api.async_register_command(hass, websocket_orphans_preview)
    websocket_api.async_register_command(hass, websocket_orphans_protect)
    websocket_api.async_register_command(hass, websocket_orphans_remove)
    websocket_api.async_register_command(hass, websocket_remove_orphan_entity)
    websocket_api.async_register_command(hass, websocket_update_entity_assignment)
    runtime[DATA_WEBSOCKET_REGISTERED] = True
