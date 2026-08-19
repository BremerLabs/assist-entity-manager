"""Assist Entity Manager integration."""
from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, VERSION
from .semantic_provider import SemanticProviderManager
from .settings import AEMSettingsStore
from .websocket import (
    DATA_SEMANTIC_PROVIDER,
    DATA_SETTINGS,
    async_register_websocket_commands,
)

PANEL_URL_PATH = "assist-entity-manager"
FRONTEND_BASE_URL = "/assist_entity_manager"
MODULE_URL = f"{FRONTEND_BASE_URL}/assist-entity-manager.js?v={VERSION}"
RUNTIME_FIX_URL = f"{FRONTEND_BASE_URL}/aem-runtime-fixes.js?v={VERSION}"
FRONTEND_DIR = Path(__file__).parent / "frontend"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up static resources and AEM-owned runtime services."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_BASE_URL, str(FRONTEND_DIR), False)]
    )

    settings = AEMSettingsStore(hass)
    await settings.async_load()

    provider = SemanticProviderManager()

    hass.data[DOMAIN] = {
        DATA_SETTINGS: settings,
        DATA_SEMANTIC_PROVIDER: provider,
    }
    async_register_websocket_commands(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Assist Entity Manager from a config entry."""
    frontend.add_extra_js_url(hass, MODULE_URL)
    frontend.add_extra_js_url(hass, RUNTIME_FIX_URL)

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

    for url in (RUNTIME_FIX_URL, MODULE_URL):
        try:
            frontend.remove_extra_js_url(hass, url)
        except (KeyError, ValueError):
            pass

    return True
