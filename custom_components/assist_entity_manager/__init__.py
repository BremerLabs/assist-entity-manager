"""Assist Entity Manager integration."""
from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

DOMAIN = "assist_entity_manager"
VERSION = "1.0.0"
PANEL_URL_PATH = "assist-entity-manager"
FRONTEND_BASE_URL = "/assist_entity_manager"
MODULE_URL = f"{FRONTEND_BASE_URL}/assist-entity-manager.js?v={VERSION}"
FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up static frontend resources."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_BASE_URL, str(FRONTEND_DIR), False)]
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Assist Entity Manager from a config entry."""
    frontend.add_extra_js_url(hass, MODULE_URL)

    if frontend.async_panel_exists(hass, PANEL_URL_PATH):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)

    await async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name="assist-entity-manager-panel",
        sidebar_title="Assist Manager",
        sidebar_icon="mdi:account-voice",
        module_url=MODULE_URL,
        config={"integration": DOMAIN},
        require_admin=False,
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Assist Entity Manager."""
    if frontend.async_panel_exists(hass, PANEL_URL_PATH):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)

    try:
        frontend.remove_extra_js_url(hass, MODULE_URL)
    except (KeyError, ValueError):
        pass

    return True
