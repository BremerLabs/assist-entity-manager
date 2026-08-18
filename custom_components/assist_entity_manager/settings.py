"""Persistent Assist Entity Manager settings."""
from __future__ import annotations

from typing import Any, TypedDict

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.settings"


class AEMSettings(TypedDict):
    """Settings owned by Assist Entity Manager itself."""

    use_semantic_control_extensions: bool


DEFAULT_SETTINGS: AEMSettings = {
    "use_semantic_control_extensions": True,
}


class AEMSettingsStore:
    """Persist only settings that are owned by AEM.

    Semantic-Control-owned policy/metadata must never be copied into this store.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
            private=True,
            atomic_writes=True,
        )
        self._settings: AEMSettings = dict(DEFAULT_SETTINGS)

    async def async_load(self) -> None:
        """Load AEM settings, preserving safe defaults for missing keys."""
        stored = await self._store.async_load()
        if not isinstance(stored, dict):
            return

        value = stored.get("use_semantic_control_extensions")
        if isinstance(value, bool):
            self._settings["use_semantic_control_extensions"] = value

    @property
    def use_semantic_control_extensions(self) -> bool:
        """Return whether AEM may access Semantic Control extensions."""
        return self._settings["use_semantic_control_extensions"]

    def as_dict(self) -> AEMSettings:
        """Return a copy of current settings."""
        return dict(self._settings)

    async def async_set_semantic_control_extensions(self, enabled: bool) -> None:
        """Persist the AEM-owned Semantic Control compatibility switch."""
        self._settings["use_semantic_control_extensions"] = bool(enabled)
        await self._store.async_save(dict(self._settings))
