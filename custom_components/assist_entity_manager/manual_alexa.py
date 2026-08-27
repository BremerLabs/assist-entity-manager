"""Read-only support for Home Assistant manual Alexa Smart Home YAML."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config as hass_config
from homeassistant.components import websocket_api
from homeassistant.components.alexa import SMART_HOME_SCHEMA
from homeassistant.components.alexa.const import CONF_ENTITY_CONFIG, CONF_FILTER, CONF_LOCALE
from homeassistant.components.alexa.entities import async_get_entities
from homeassistant.components.alexa.smart_home import AlexaConfig
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN

DATA_MANUAL_ALEXA_WS_REGISTERED = "manual_alexa_ws_registered"
ALEXA_DOMAIN = "alexa"
CONF_SMART_HOME = "smart_home"


async def _load_manual_alexa_config(
    hass: HomeAssistant,
) -> tuple[bool, dict[str, Any] | None]:
    """Load the resolved manual Alexa config using Home Assistant's loader."""
    full_config = await hass_config.async_hass_config_yaml(hass)
    alexa_config = full_config.get(ALEXA_DOMAIN)

    if not isinstance(alexa_config, dict) or CONF_SMART_HOME not in alexa_config:
        return False, None

    return True, SMART_HOME_SCHEMA(alexa_config.get(CONF_SMART_HOME) or {})


def _discovery_state(
    hass: HomeAssistant,
    smart_home: dict[str, Any],
) -> tuple[set[str], set[str]]:
    """Return Alexa-supported and actually discoverable entity ids.

    This deliberately follows Home Assistant's own Alexa.Discovery pipeline:
    ``async_get_entities`` first removes entities that do not have a usable
    Alexa adapter/interface, then ``AlexaConfig.should_expose`` applies the
    YAML filter, and finally discovery serialization must succeed.
    """
    config = AlexaConfig(hass, smart_home)
    supported: set[str] = set()
    discovered: set[str] = set()

    for alexa_entity in async_get_entities(hass, config):
        entity_id = alexa_entity.entity_id
        supported.add(entity_id)

        if not config.should_expose(entity_id):
            continue

        try:
            alexa_entity.serialize_discovery()
        except Exception:  # Match HA discovery: failed endpoints are omitted.
            continue

        discovered.add(entity_id)

    return supported, discovered


async def _payload(hass: HomeAssistant, entity_ids: list[str]) -> dict[str, Any]:
    configured, smart_home = await _load_manual_alexa_config(hass)
    component_loaded = ALEXA_DOMAIN in hass.config.components

    if not configured or smart_home is None:
        return {
            "configured": False,
            "component_loaded": component_loaded,
            "enabled": False,
            "mode": "manual_yaml",
            "read_only": True,
            "entities": {},
        }

    entity_config = smart_home.get(CONF_ENTITY_CONFIG) or {}
    entity_filter = smart_home[CONF_FILTER]
    supported, discovered = _discovery_state(hass, smart_home)

    entities: dict[str, dict[str, Any]] = {}
    for entity_id in entity_ids:
        per_entity = entity_config.get(entity_id) or {}
        entities[entity_id] = {
            "supported": entity_id in supported,
            "exposed": entity_id in discovered,
            "name": per_entity.get("name"),
        }

    return {
        "configured": True,
        "component_loaded": component_loaded,
        "enabled": component_loaded,
        "mode": "manual_yaml",
        "read_only": True,
        "locale": smart_home.get(CONF_LOCALE),
        "filter_is_empty": bool(entity_filter.empty_filter),
        "entity_config_count": len(entity_config),
        "supported_entity_count": len(supported),
        "discovered_entity_count": len(discovered),
        "entities": entities,
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): "assist_entity_manager/alexa_manual/status",
        vol.Optional("entity_ids", default=[]): [cv.entity_id],
    }
)
@websocket_api.async_response
async def websocket_manual_alexa_status(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return read-only manual Alexa status."""
    try:
        result = await _payload(hass, list(msg.get("entity_ids") or []))
    except Exception as err:
        connection.send_error(
            msg["id"],
            "manual_alexa_config_error",
            f"Manual Alexa configuration could not be evaluated: {err}",
        )
        return

    connection.send_result(msg["id"], result)


def async_register_manual_alexa_websocket_commands(hass: HomeAssistant) -> None:
    """Register the Manual Alexa read-only websocket once."""
    runtime = hass.data.setdefault(DOMAIN, {})
    if runtime.get(DATA_MANUAL_ALEXA_WS_REGISTERED):
        return

    websocket_api.async_register_command(hass, websocket_manual_alexa_status)
    runtime[DATA_MANUAL_ALEXA_WS_REGISTERED] = True
