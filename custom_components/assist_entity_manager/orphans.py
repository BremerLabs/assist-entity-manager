"""Persistent orphan-candidate observation and safe cleanup for AEM.

The manager deliberately separates three concerns:

* availability observation: AEM records how long a registry entity has continuously
  been unavailable/not provided; Home Assistant does not expose a durable generic
  "unavailable since" timestamp for this purpose.
* candidate classification: reaching the user-configured age only makes an entity a
  candidate. Nothing is ever deleted automatically.
* destructive cleanup: every removal request performs a fresh reference scan and a
  fresh candidate check before touching Home Assistant's Entity Registry.
"""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from datetime import timedelta
import re
import time
from typing import Any
from urllib.parse import quote

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import CoreState, HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .settings import AEMSettingsStore

DATA_ORPHAN_MANAGER = "orphan_manager"
STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.orphan_state"
MAX_HISTORY = 100
RECONCILE_INTERVAL = timedelta(minutes=15)

STRONG_SOURCE_SIGNALS = {"not_provided", "config_entry_missing"}


class OrphanCleanupError(HomeAssistantError):
    """Raised when a requested cleanup cannot be performed safely."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class AEMOrphanManager:
    """Observe entity availability and manage explicit orphan cleanup."""

    def __init__(self, hass: HomeAssistant, settings: AEMSettingsStore) -> None:
        self.hass = hass
        self.settings = settings
        self._store = Store[dict[str, Any]](
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
            private=True,
            atomic_writes=True,
        )
        self._observations: dict[str, dict[str, Any]] = {}
        self._protected: set[str] = set()
        self._history: list[dict[str, Any]] = []
        self._unsubs: list[Callable[[], None]] = []
        self._save_task: asyncio.Task[None] | None = None
        self._started = hass.state is CoreState.running

    async def async_setup(self) -> None:
        """Load persistent state and start observation."""
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            observations = stored.get("observations")
            if isinstance(observations, dict):
                self._observations = {
                    entity_id: value
                    for entity_id, value in observations.items()
                    if isinstance(entity_id, str) and isinstance(value, dict)
                }
            protected = stored.get("protected")
            if isinstance(protected, list):
                self._protected = {value for value in protected if isinstance(value, str)}
            history = stored.get("history")
            if isinstance(history, list):
                self._history = [item for item in history if isinstance(item, dict)][
                    -MAX_HISTORY:
                ]

        self._unsubs.append(self.hass.bus.async_listen("state_changed", self._state_changed))
        self._unsubs.append(
            self.hass.bus.async_listen("entity_registry_updated", self._registry_changed)
        )

        if self._started:
            self.async_reconcile_all()
        else:
            self._unsubs.append(
                self.hass.bus.async_listen_once(
                    "homeassistant_started", self._home_assistant_started
                )
            )

        self._unsubs.append(
            async_track_time_interval(
                self.hass,
                self._periodic_reconcile,
                RECONCILE_INTERVAL,
                name="Assist Entity Manager orphan observation",
            )
        )
        self._prune_missing_registry_entries()
        self._schedule_save()

    async def async_shutdown(self) -> None:
        """Stop listeners and persist current state."""
        for unsub in self._unsubs:
            try:
                unsub()
            except Exception:
                pass
        self._unsubs.clear()

        if self._save_task is not None and not self._save_task.done():
            self._save_task.cancel()
            try:
                await self._save_task
            except asyncio.CancelledError:
                pass
        self._save_task = None
        await self._async_save()

    @callback
    def _home_assistant_started(self, _event: Any) -> None:
        self._started = True
        self.async_reconcile_all()

    async def _periodic_reconcile(self, _now: Any) -> None:
        if self._started:
            self.async_reconcile_all()

    @callback
    def _state_changed(self, event: Any) -> None:
        data = event.data
        entity_id = data.get("entity_id")
        if not isinstance(entity_id, str):
            return
        new_state = data.get("new_state")
        if (
            entity_id not in self._observations
            and new_state is not None
            and new_state.state != STATE_UNAVAILABLE
            and not bool(new_state.attributes.get("restored"))
        ):
            # The overwhelming majority of state_changed events are normal sensor
            # updates. They cannot start an orphan observation, so avoid a registry
            # lookup and storage work for those events.
            return
        registry = er.async_get(self.hass)
        entry = registry.async_get(entity_id)
        if entry is None:
            self._observations.pop(entity_id, None)
            self._protected.discard(entity_id)
            self._schedule_save()
            return
        self._observe(entity_id, entry, new_state)

    @callback
    def _registry_changed(self, event: Any) -> None:
        entity_id = event.data.get("entity_id")
        if not isinstance(entity_id, str):
            return
        old_entity_id = event.data.get("old_entity_id")
        if isinstance(old_entity_id, str) and old_entity_id != entity_id:
            if old_entity_id in self._observations and entity_id not in self._observations:
                self._observations[entity_id] = self._observations.pop(old_entity_id)
            else:
                self._observations.pop(old_entity_id, None)
            if old_entity_id in self._protected:
                self._protected.discard(old_entity_id)
                self._protected.add(entity_id)
            self._schedule_save()
        registry = er.async_get(self.hass)
        entry = registry.async_get(entity_id)
        if entry is None:
            self._observations.pop(entity_id, None)
            self._protected.discard(entity_id)
            self._schedule_save()
            return
        if not self._started:
            return
        self._observe(entity_id, entry, self.hass.states.get(entity_id))

    @callback
    def async_reconcile_all(self) -> None:
        """Reconcile observations with the current Entity Registry and state machine."""
        registry = er.async_get(self.hass)
        current_ids = set(registry.entities)
        changed = False

        for entity_id in list(self._observations):
            if entity_id not in current_ids:
                self._observations.pop(entity_id, None)
                self._protected.discard(entity_id)
                changed = True

        for entity_id in current_ids:
            entry = registry.async_get(entity_id)
            if entry is None:
                continue
            if self._observe(
                entity_id,
                entry,
                self.hass.states.get(entity_id),
                schedule=False,
            ):
                changed = True

        if changed:
            self._schedule_save()

    @callback
    def _observe(
        self,
        entity_id: str,
        entry: er.RegistryEntry,
        state: State | None,
        *,
        schedule: bool = True,
    ) -> bool:
        """Update continuous-unavailability observation for one entity."""
        # During startup a missing state is not evidence; integrations may simply not
        # have finished adding their entities yet. Real unavailable/restored states are
        # still useful and can be observed immediately.
        if state is None and not self._started:
            return False

        signal = self._availability_signal(entry, state)
        previous = self._observations.get(entity_id)

        if signal is None:
            if previous is None:
                return False
            self._observations.pop(entity_id, None)
            if schedule:
                self._schedule_save()
            return True

        now = time.time()
        if previous is None:
            self._observations[entity_id] = {
                "since": now,
                "signal": signal,
                "last_state": state.state if state is not None else None,
                "platform": entry.platform,
            }
            if schedule:
                self._schedule_save()
            return True

        changed = False
        if previous.get("signal") != signal:
            # The entity stayed continuously unavailable, so preserve the original
            # timestamp while keeping the strongest/current diagnostic reason.
            previous["signal"] = signal
            changed = True
        state_value = state.state if state is not None else None
        if previous.get("last_state") != state_value:
            previous["last_state"] = state_value
            changed = True
        if previous.get("platform") != entry.platform:
            previous["platform"] = entry.platform
            changed = True
        if changed and schedule:
            self._schedule_save()
        return changed

    @callback
    def _availability_signal(
        self, entry: er.RegistryEntry, state: State | None
    ) -> str | None:
        """Return an AEM observation signal or None for an active entity.

        `unknown` deliberately does not count as offline. Home Assistant's frontend
        identifies a no-longer-provided placeholder by the truthiness of the
        `restored` state attribute, so AEM follows that semantic instead of guessing
        from the localized UI text.
        """
        if entry.disabled_by is not None:
            return None
        config_entry_missing = bool(
            entry.config_entry_id
            and self.hass.config_entries.async_get_entry(entry.config_entry_id) is None
        )
        if state is None:
            return "config_entry_missing" if config_entry_missing else "no_state"
        if bool(state.attributes.get("restored")):
            return "not_provided"
        if state.state == STATE_UNAVAILABLE:
            return "config_entry_missing" if config_entry_missing else "unavailable"
        if state.state == STATE_UNKNOWN:
            return None
        return None

    @callback
    def _source_reason(self, entry: er.RegistryEntry, state: State | None) -> str:
        config_entry_missing = bool(
            entry.config_entry_id
            and self.hass.config_entries.async_get_entry(entry.config_entry_id) is None
        )
        if state is not None and bool(state.attributes.get("restored")):
            return "not_provided"
        if state is None:
            return "config_entry_missing" if config_entry_missing else "no_state"
        if state.state == STATE_UNAVAILABLE:
            return "config_entry_missing" if config_entry_missing else "unavailable"
        return "active"

    @callback
    def _candidate_info(self, entity_id: str) -> dict[str, Any] | None:
        registry = er.async_get(self.hass)
        entry = registry.async_get(entity_id)
        if entry is None:
            return None

        state = self.hass.states.get(entity_id)
        # Refresh in memory before classification; this also rejects entities that
        # recovered since the list was last rendered.
        self._observe(entity_id, entry, state)
        observation = self._observations.get(entity_id)
        if observation is None:
            return {
                "entity_id": entity_id,
                "name": self._entity_name(entity_id, entry, state),
                "platform": entry.platform,
                "status": "active",
                "candidate": False,
                "protected": entity_id in self._protected,
            }

        now = time.time()
        since = self._coerce_timestamp(observation.get("since"), now)
        elapsed_seconds = max(0.0, now - since)
        threshold_days = self.settings.orphan_candidate_days
        threshold_seconds = threshold_days * 86400
        candidate = elapsed_seconds >= threshold_seconds
        source_reason = self._source_reason(entry, state)
        protected = entity_id in self._protected

        if protected:
            status = "protected"
        elif candidate:
            status = (
                "orphan_candidate"
                if source_reason in STRONG_SOURCE_SIGNALS
                else "offline_candidate"
            )
        else:
            status = "observing"

        return {
            "entity_id": entity_id,
            "name": self._entity_name(entity_id, entry, state),
            "platform": entry.platform,
            "status": status,
            "candidate": candidate,
            "protected": protected,
            "signal": observation.get("signal"),
            "source_reason": source_reason,
            "unavailable_since": since,
            "unavailable_seconds": elapsed_seconds,
            "unavailable_days": elapsed_seconds / 86400,
            "candidate_after_days": threshold_days,
            "current_state": state.state if state is not None else None,
            "restored": bool(state and state.attributes.get("restored")),
            "config_entry_id": entry.config_entry_id,
            "device_id": entry.device_id,
        }

    @callback
    def list_payload(self) -> dict[str, Any]:
        """Return candidates, protected entries and observation summary."""
        if self._started:
            self.async_reconcile_all()

        registry = er.async_get(self.hass)
        candidates: list[dict[str, Any]] = []
        observing: list[dict[str, Any]] = []
        protected: list[dict[str, Any]] = []

        for entity_id in sorted(registry.entities):
            if entity_id not in self._observations and entity_id not in self._protected:
                continue
            info = self._candidate_info(entity_id)
            if info is None:
                continue
            if info["protected"]:
                protected.append(info)
            elif info.get("candidate"):
                candidates.append(info)
            elif info["status"] == "observing":
                observing.append(info)

        candidates.sort(key=lambda item: item.get("unavailable_since", 0))
        observing.sort(key=lambda item: item.get("unavailable_since", 0))
        protected.sort(key=lambda item: item["entity_id"])

        return {
            "candidate_after_days": self.settings.orphan_candidate_days,
            "candidates": candidates,
            "observing": observing,
            "protected": protected,
            "history": list(reversed(self._history[-30:])),
            "summary": {
                "candidates": len(candidates),
                "observing": len(observing),
                "protected": len(protected),
            },
            "observation_started_now_for_unknown_history": True,
        }

    async def async_preview(self, entity_id: str) -> dict[str, Any]:
        """Freshly validate a candidate and scan references."""
        info = self._candidate_info(entity_id)
        if info is None:
            return {
                "eligible": False,
                "reason": "entity_not_found",
                "entity_id": entity_id,
            }
        if not info.get("candidate"):
            return {
                "eligible": False,
                "reason": "not_candidate",
                "entity": info,
            }
        if info.get("protected"):
            return {
                "eligible": False,
                "reason": "protected",
                "entity": info,
            }

        reference_result = await self._scan_references(entity_id)
        strong_source = info.get("source_reason") in STRONG_SOURCE_SIGNALS
        safe = (
            reference_result["complete"]
            and not reference_result["references"]
            and strong_source
        )

        return {
            "eligible": True,
            "entity": info,
            "references": reference_result["references"],
            "reference_count": len(reference_result["references"]),
            "reference_check_complete": reference_result["complete"],
            "reference_check_errors": reference_result["errors"],
            "safe_cleanup_candidate": safe,
            "source_still_may_recreate": not strong_source,
            "requires_reference_confirmation": bool(reference_result["references"]),
            "requires_incomplete_confirmation": not reference_result["complete"],
            "requires_source_confirmation": not strong_source,
        }

    async def async_remove(
        self,
        entity_id: str,
        *,
        confirm_references: bool,
        confirm_incomplete: bool,
        confirm_source_active: bool,
    ) -> dict[str, Any]:
        """Remove a candidate after a fresh server-side safety check."""
        preview = await self.async_preview(entity_id)
        if not preview.get("eligible"):
            reason = str(preview.get("reason") or "not_eligible")
            raise OrphanCleanupError(
                reason,
                "The entity is no longer an eligible orphan cleanup candidate.",
            )

        if preview["reference_count"] and not confirm_references:
            raise OrphanCleanupError(
                "references_present",
                "The entity is still referenced. Explicit confirmation is required.",
            )
        if not preview["reference_check_complete"] and not confirm_incomplete:
            raise OrphanCleanupError(
                "reference_check_incomplete",
                "The reference check was incomplete. Explicit confirmation is required.",
            )
        if preview["source_still_may_recreate"] and not confirm_source_active:
            raise OrphanCleanupError(
                "source_may_recreate",
                "The source may still provide or recreate this entity. Explicit confirmation is required.",
            )

        registry = er.async_get(self.hass)
        entry = registry.async_get(entity_id)
        if entry is None:
            raise OrphanCleanupError("entity_not_found", "The entity no longer exists.")

        removed_at = time.time()
        source_reason = preview["entity"].get("source_reason")
        platform = entry.platform
        registry.async_remove(entity_id)

        state_still_present = self.hass.states.get(entity_id) is not None
        history_entry = {
            "entity_id": entity_id,
            "name": preview["entity"].get("name") or entity_id,
            "platform": platform,
            "removed_at": removed_at,
            "source_reason": source_reason,
            "reference_count": preview["reference_count"],
            "reference_check_complete": preview["reference_check_complete"],
            "confirmed_references": bool(confirm_references),
            "confirmed_incomplete": bool(confirm_incomplete),
            "confirmed_source_active": bool(confirm_source_active),
            "state_still_present": state_still_present,
        }
        self._history.append(history_entry)
        self._history = self._history[-MAX_HISTORY:]
        self._observations.pop(entity_id, None)
        self._protected.discard(entity_id)
        await self._async_save()

        return {
            "removed": True,
            "entity_id": entity_id,
            "state_still_present": state_still_present,
            "history": history_entry,
        }

    async def async_set_protected(self, entity_id: str, protected: bool) -> dict[str, Any]:
        registry = er.async_get(self.hass)
        if registry.async_get(entity_id) is None:
            raise OrphanCleanupError("entity_not_found", "The entity does not exist.")
        if protected:
            self._protected.add(entity_id)
        else:
            self._protected.discard(entity_id)
        await self._async_save()
        return {"entity_id": entity_id, "protected": protected}

    async def _scan_references(self, entity_id: str) -> dict[str, Any]:
        references: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []

        try:
            from homeassistant.components import automation, group, person, script
            from homeassistant.components.homeassistant import scene
        except Exception as err:
            return {
                "references": [],
                "errors": [{
                    "scope": "home_assistant",
                    "message": f"Home Assistant reference helpers are unavailable: {err}",
                }],
                "complete": False,
            }

        def collect(
            category: str,
            component_name: str,
            finder: Any,
        ) -> None:
            if component_name not in self.hass.config.components:
                # If the component is not loaded there is no active configuration of
                # this type for Home Assistant to resolve. Treat the scope as empty;
                # configured automations/scripts/scenes/groups/persons load their
                # component and are then checked through Home Assistant's own helpers.
                return
            try:
                related = finder(self.hass, entity_id)
            except Exception as err:  # Fail closed: never call this scan complete.
                errors.append(
                    {
                        "scope": category,
                        "message": str(err) or err.__class__.__name__,
                    }
                )
                return
            for related_id in related:
                references.append(self._reference_for_entity(category, related_id))

        collect("automation", "automation", automation.automations_with_entity)
        collect("script", "script", script.scripts_with_entity)
        collect("scene", "scene", scene.scenes_with_entity)
        collect("group", "group", group.groups_with_entity)
        collect("person", "person", person.persons_with_entity)

        dashboard_refs, dashboard_errors = await self._scan_dashboards(entity_id)
        references.extend(dashboard_refs)
        errors.extend(dashboard_errors)

        # Stable de-duplication while retaining useful per-dashboard contexts.
        unique: dict[tuple[str, str, str], dict[str, Any]] = {}
        for item in references:
            key = (
                str(item.get("type") or ""),
                str(item.get("id") or item.get("entity_id") or ""),
                str(item.get("context") or ""),
            )
            unique[key] = item

        return {
            "references": list(unique.values()),
            "errors": errors,
            "complete": not errors,
        }

    async def _scan_dashboards(
        self, entity_id: str
    ) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
        refs: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []

        try:
            from homeassistant.components.lovelace.const import LOVELACE_DATA, ConfigNotFound
        except Exception as err:
            return refs, [
                {
                    "scope": "dashboard",
                    "message": f"Lovelace API unavailable: {err}",
                }
            ]

        lovelace_data = self.hass.data.get(LOVELACE_DATA)
        dashboards = getattr(lovelace_data, "dashboards", None)
        if dashboards is None:
            return refs, [
                {
                    "scope": "dashboard",
                    "message": "Lovelace dashboard data is not loaded.",
                }
            ]

        for key, dashboard in list(dashboards.items()):
            try:
                config = await dashboard.async_load(False)
            except ConfigNotFound:
                # Auto-generated/empty dashboards have no explicit reference to scan.
                continue
            except Exception as err:
                errors.append(
                    {
                        "scope": "dashboard",
                        "message": f"{key!s}: {str(err) or err.__class__.__name__}",
                    }
                )
                continue

            if not isinstance(config, dict):
                errors.append(
                    {
                        "scope": "dashboard",
                        "message": f"{key!s}: dashboard configuration has an unexpected format.",
                    }
                )
                continue

            dashboard_title = self._dashboard_title(dashboard, key)
            url_path = getattr(dashboard, "url_path", None)
            base_url = "/lovelace" if not url_path or url_path == "lovelace" else f"/{url_path}"
            views = config.get("views")

            if isinstance(views, list):
                for index, view in enumerate(views):
                    if not isinstance(view, dict):
                        continue
                    matches = list(self._find_value_paths(view, entity_id, f"views[{index}]"))
                    if not matches:
                        continue
                    view_path = view.get("path")
                    view_title = (
                        view.get("title")
                        or view_path
                        or f"View {index + 1}"
                    )
                    target_url = (
                        f"{base_url}/{quote(str(view_path), safe='')}"
                        if view_path
                        else base_url
                    )
                    refs.append(
                        {
                            "type": "dashboard",
                            "id": f"{key!s}:{index}",
                            "name": dashboard_title,
                            "context": f"{view_title} · {', '.join(matches[:4])}",
                            "url": target_url,
                            "paths": matches[:20],
                        }
                    )

                top_level = {key_: value for key_, value in config.items() if key_ != "views"}
                matches = list(self._find_value_paths(top_level, entity_id, "dashboard"))
                if matches:
                    refs.append(
                        {
                            "type": "dashboard",
                            "id": f"{key!s}:root",
                            "name": dashboard_title,
                            "context": ", ".join(matches[:4]),
                            "url": base_url,
                            "paths": matches[:20],
                        }
                    )
            else:
                matches = list(self._find_value_paths(config, entity_id, "dashboard"))
                if matches:
                    refs.append(
                        {
                            "type": "dashboard",
                            "id": f"{key!s}:root",
                            "name": dashboard_title,
                            "context": ", ".join(matches[:4]),
                            "url": base_url,
                            "paths": matches[:20],
                        }
                    )

        return refs, errors

    def _reference_for_entity(self, category: str, entity_id: str) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        registry = er.async_get(self.hass)
        entry = registry.async_get(entity_id)
        name = (
            state.attributes.get("friendly_name")
            if state is not None
            else None
        ) or (entry.name if entry is not None else None) or entity_id

        unique_id = None
        if state is not None:
            unique_id = state.attributes.get("id")
        if not unique_id and entry is not None:
            unique_id = entry.unique_id

        url = None
        if category in {"automation", "script", "scene"}:
            url = (
                f"/config/{category}/edit/{quote(str(unique_id), safe='')}"
                if unique_id
                else f"/config/{category}/dashboard"
            )

        return {
            "type": category,
            "id": entity_id,
            "entity_id": entity_id,
            "name": str(name),
            "context": self._reference_context(category),
            "url": url,
        }

    @staticmethod
    def _reference_context(category: str) -> str:
        return {
            "automation": "Automation",
            "script": "Script",
            "scene": "Scene",
            "group": "Group",
            "person": "Person",
        }.get(category, category)

    @staticmethod
    def _find_value_paths(value: Any, needle: str, path: str) -> Iterable[str]:
        if isinstance(value, str):
            # Dashboard values can be plain entity IDs, templates, CSS-like text or
            # other free-form strings. Match the entity ID as a token so that
            # `sensor.foo` does not falsely match `sensor.foo_bar`.
            pattern = rf"(?<![A-Za-z0-9_]){re.escape(needle)}(?![A-Za-z0-9_])"
            if re.search(pattern, value):
                yield path
            return
        if isinstance(value, dict):
            for key, child in value.items():
                yield from AEMOrphanManager._find_value_paths(
                    child, needle, f"{path}.{key}"
                )
            return
        if isinstance(value, list):
            for index, child in enumerate(value):
                yield from AEMOrphanManager._find_value_paths(
                    child, needle, f"{path}[{index}]"
                )

    @staticmethod
    def _dashboard_title(dashboard: Any, key: Any) -> str:
        config = getattr(dashboard, "config", None)
        if isinstance(config, dict):
            title = config.get("title")
            if isinstance(title, str) and title:
                return title
            url_path = config.get("url_path")
            if isinstance(url_path, str) and url_path:
                return url_path
        return "Home" if key in (None, "lovelace") else str(key)

    @staticmethod
    def _entity_name(
        entity_id: str, entry: er.RegistryEntry, state: State | None
    ) -> str:
        if state is not None:
            friendly_name = state.attributes.get("friendly_name")
            if isinstance(friendly_name, str) and friendly_name:
                return friendly_name
        for candidate in (entry.name, entry.original_name):
            if isinstance(candidate, str) and candidate:
                return candidate
        return entity_id

    @staticmethod
    def _coerce_timestamp(value: Any, fallback: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

    @callback
    def _prune_missing_registry_entries(self) -> None:
        registry = er.async_get(self.hass)
        current = set(registry.entities)
        changed = False
        for entity_id in list(self._observations):
            if entity_id not in current:
                self._observations.pop(entity_id, None)
                changed = True
        for entity_id in list(self._protected):
            if entity_id not in current:
                self._protected.discard(entity_id)
                changed = True
        if changed:
            self._schedule_save()

    @callback
    def _schedule_save(self) -> None:
        if self._save_task is not None and not self._save_task.done():
            return
        self._save_task = self.hass.async_create_task(
            self._async_delayed_save(), "AEM orphan state save"
        )

    async def _async_delayed_save(self) -> None:
        try:
            await asyncio.sleep(2)
            await self._async_save()
        finally:
            self._save_task = None

    async def _async_save(self) -> None:
        await self._store.async_save(
            {
                "observations": self._observations,
                "protected": sorted(self._protected),
                "history": self._history[-MAX_HISTORY:],
            }
        )
