"""Optional Assist Semantic Control provider boundary for AEM.

This module defines AEM's *internal* adapter contract only. It intentionally does
not define, guess, or call any external Assist Semantic Control API. A concrete
adapter can be added once the external provider contract is agreed and exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, runtime_checkable

AEM_PROVIDER_ADAPTER_API_VERSION = 1

STATE_DISABLED = "disabled"
STATE_NOT_AVAILABLE = "not_available"
STATE_COMPATIBLE = "compatible"
STATE_INCOMPATIBLE = "incompatible"
STATE_UNAVAILABLE = "unavailable"
STATE_INCOMPLETE = "incomplete"

KNOWN_STATES = {
    STATE_DISABLED,
    STATE_NOT_AVAILABLE,
    STATE_COMPATIBLE,
    STATE_INCOMPATIBLE,
    STATE_UNAVAILABLE,
    STATE_INCOMPLETE,
}


@dataclass(frozen=True, slots=True)
class SemanticProviderSnapshot:
    """Normalized provider information consumed by AEM.

    ``schema`` is deliberately opaque to this layer. A future concrete adapter
    is responsible for validating the external provider's contract before
    returning a compatible snapshot. Unknown schema properties are not treated
    as errors merely because AEM has not seen them before.
    """

    state: str
    provider_name: str | None = None
    contract_version: str | None = None
    capabilities: tuple[str, ...] = ()
    schema: Mapping[str, Any] | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable representation for the AEM frontend."""
        result: dict[str, Any] = {
            "state": self.state,
            "provider_name": self.provider_name,
            "contract_version": self.contract_version,
            "capabilities": list(self.capabilities),
            "schema": dict(self.schema) if self.schema is not None else None,
            "error": self.error,
        }
        return result


@runtime_checkable
class SemanticControlProviderAdapter(Protocol):
    """AEM-internal adapter interface.

    Method names here are not requirements on Assist Semantic Control itself.
    A future concrete adapter translates the real external contract to this
    internal interface.
    """

    aem_adapter_api_version: int

    async def async_get_snapshot(self) -> SemanticProviderSnapshot:
        """Return already validated provider metadata/schema information."""

    async def async_read_entity_data(self, entity_id: str) -> Mapping[str, Any]:
        """Read provider-owned data for one Home Assistant entity."""

    async def async_write_entity_data(
        self, entity_id: str, changes: Mapping[str, Any]
    ) -> Mapping[str, Any]:
        """Write provider-owned mutable data for one Home Assistant entity."""


class SemanticProviderDisabledError(RuntimeError):
    """Raised when semantic provider access is disabled in AEM."""


class SemanticProviderUnavailableError(RuntimeError):
    """Raised when no usable semantic provider adapter is available."""


class SemanticProviderManager:
    """Single boundary between AEM and an optional Semantic Control adapter."""

    def __init__(self) -> None:
        self._adapter: SemanticControlProviderAdapter | None = None

    def set_adapter(self, adapter: SemanticControlProviderAdapter | None) -> None:
        """Install an AEM-side adapter.

        Production code currently does not install an adapter because the real
        Assist Semantic Control contract does not exist in this repository.
        This hook is intentionally internal and also enables controlled test
        doubles without inventing external services or endpoints.
        """
        self._adapter = adapter

    @property
    def has_adapter(self) -> bool:
        """Return whether an AEM-side adapter has been installed."""
        return self._adapter is not None

    def _compatible_adapter(self) -> SemanticControlProviderAdapter | None:
        adapter = self._adapter
        if adapter is None:
            return None
        if (
            getattr(adapter, "aem_adapter_api_version", None)
            != AEM_PROVIDER_ADAPTER_API_VERSION
        ):
            return None
        return adapter

    async def async_get_snapshot(self, *, enabled: bool) -> SemanticProviderSnapshot:
        """Return normalized provider status without unsafe fallback behavior."""
        if not enabled:
            return SemanticProviderSnapshot(state=STATE_DISABLED)

        if self._adapter is None:
            return SemanticProviderSnapshot(
                state=STATE_NOT_AVAILABLE,
                error="No AEM Semantic Control adapter is registered.",
            )

        if self._compatible_adapter() is None:
            return SemanticProviderSnapshot(
                state=STATE_INCOMPATIBLE,
                error="The registered AEM provider adapter uses an unsupported adapter API version.",
            )

        try:
            snapshot = await self._adapter.async_get_snapshot()
        except Exception as err:  # Adapter failures must never break core AEM.
            return SemanticProviderSnapshot(
                state=STATE_UNAVAILABLE,
                error=str(err) or err.__class__.__name__,
            )

        if not isinstance(snapshot, SemanticProviderSnapshot):
            return SemanticProviderSnapshot(
                state=STATE_INCOMPLETE,
                error="The provider adapter returned incomplete provider information.",
            )

        if snapshot.state not in KNOWN_STATES:
            return SemanticProviderSnapshot(
                state=STATE_INCOMPLETE,
                provider_name=snapshot.provider_name,
                contract_version=snapshot.contract_version,
                error="The provider adapter returned an unknown status.",
            )

        return snapshot

    async def async_read_entity_data(
        self, entity_id: str, *, enabled: bool
    ) -> Mapping[str, Any]:
        """Read provider-owned entity data only when explicitly enabled."""
        if not enabled:
            raise SemanticProviderDisabledError(
                "Semantic Control extensions are disabled in Assist Entity Manager."
            )

        adapter = self._compatible_adapter()
        if adapter is None:
            raise SemanticProviderUnavailableError(
                "No compatible Semantic Control provider adapter is available."
            )

        return await adapter.async_read_entity_data(entity_id)

    async def async_write_entity_data(
        self,
        entity_id: str,
        changes: Mapping[str, Any],
        *,
        enabled: bool,
    ) -> Mapping[str, Any]:
        """Write provider-owned entity data only when explicitly enabled."""
        if not enabled:
            raise SemanticProviderDisabledError(
                "Semantic Control extensions are disabled in Assist Entity Manager."
            )

        adapter = self._compatible_adapter()
        if adapter is None:
            raise SemanticProviderUnavailableError(
                "No compatible Semantic Control provider adapter is available."
            )

        return await adapter.async_write_entity_data(entity_id, changes)
