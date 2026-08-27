"""Persistent Assist Entity Manager settings."""
from __future__ import annotations

from typing import Any, TypedDict

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.settings"
DEFAULT_ORPHAN_CANDIDATE_DAYS = 30
MIN_ORPHAN_CANDIDATE_DAYS = 0


class AEMSettings(TypedDict):
    """Settings owned by Assist Entity Manager itself."""

    use_semantic_control_extensions: bool
    orphan_candidate_days: int


DEFAULT_SETTINGS: AEMSettings = {
    "use_semantic_control_extensions": True,
    "orphan_candidate_days": DEFAULT_ORPHAN_CANDIDATE_DAYS,
}


class AEMSettingsStore:
    """Persist only settings that are owned by AEM."""

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

        orphan_days = stored.get("orphan_candidate_days")
        if (
            isinstance(orphan_days, int)
            and not isinstance(orphan_days, bool)
            and orphan_days >= MIN_ORPHAN_CANDIDATE_DAYS
        ):
            self._settings["orphan_candidate_days"] = orphan_days

    @property
    def use_semantic_control_extensions(self) -> bool:
        """Return whether AEM may access Semantic Control extensions."""
        return self._settings["use_semantic_control_extensions"]

    @property
    def orphan_candidate_days(self) -> int:
        """Return the configured orphan candidate observation threshold."""
        return self._settings["orphan_candidate_days"]

    def as_dict(self) -> AEMSettings:
        """Return a copy of current settings."""
        return dict(self._settings)

    async def async_set_semantic_control_extensions(self, enabled: bool) -> None:
        """Persist the AEM-owned Semantic Control compatibility switch."""
        self._settings["use_semantic_control_extensions"] = bool(enabled)
        await self._store.async_save(dict(self._settings))

    async def async_set_orphan_candidate_days(self, days: int) -> None:
        """Persist the orphan candidate observation threshold."""
        if isinstance(days, bool) or not isinstance(days, int):
            raise ValueError("orphan_candidate_days must be an integer")
        if days < MIN_ORPHAN_CANDIDATE_DAYS:
            raise ValueError(
                f"orphan_candidate_days must be at least {MIN_ORPHAN_CANDIDATE_DAYS}"
            )

        self._settings["orphan_candidate_days"] = days
        await self._store.async_save(dict(self._settings))
