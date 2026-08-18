# Assist Semantic Control provider contract needed by AEM

This document describes **only what Assist Entity Manager (AEM) needs** from a future Assist Semantic Control integration. It is not an implementation or final API specification for Assist Semantic Control.

## Status

### Implemented and verified in AEM

- AEM has an internal provider/adapter boundary in `semantic_provider.py`.
- The internal adapter API is versioned independently from any future external Semantic Control contract.
- AEM can operate with no adapter registered.
- AEM can be disabled from accessing Semantic Control extensions through an AEM-owned persistent setting.
- When disabled, the provider manager does not call the adapter for status, reads, or writes.
- AEM rejects an unknown internal adapter API version instead of calling it.
- Adapter failures are converted to a contained `unavailable` status instead of breaking normal AEM behavior.
- AEM's normalized provider snapshot can carry opaque/dynamic capability and schema information without a hard-coded Semantic Control field list.
- The admin/developer WebSocket commands added by AEM are **AEM-owned commands**, not Semantic Control API endpoints.

### Not yet verified / must be agreed with the Semantic Control project

The actual Assist Semantic Control integration and its final public contract are not present in this repository. Therefore the following are intentionally **not implemented as external calls** yet:

- the provider's final Home Assistant integration domain
- how AEM discovers the provider
- external API/transport names (WebSocket commands, services, coordinator objects, events, etc.)
- the external contract-version format and compatibility rules
- the final capability/schema document shape
- entity-data read operation and response shape
- entity-data write operation and validation/error shape
- refresh/invalidation mechanism
- provider-originated change notifications, if needed

No names for those external interfaces should be inferred from the AEM internal adapter method names.

## Minimum external abilities AEM will need

A future concrete AEM adapter must be able to translate the real Semantic Control contract into the following abilities.

### 1. Provider detection

AEM needs a reliable, side-effect-free way to determine whether a compatible Semantic Control provider is available.

Required properties:

- must not require AEM to modify or enable Semantic Control
- absence must be a normal state, not an error loop
- provider presence alone must not be treated as compatibility

**Exact mechanism: TBD with Semantic Control.**

### 2. Version / compatibility information

AEM needs enough information to decide whether the external provider contract can safely be interpreted.

Requirements:

- explicit contract/interface version information
- documented compatibility rules
- unknown/new incompatible versions must be rejected safely
- AEM must not guess compatibility from the integration version alone unless Semantic Control explicitly defines that rule

**Version format and rules: TBD.**

### 3. Capability / schema retrieval

Semantic Control must be able to describe the additional AI-specific properties it offers.

AEM requires a machine-readable description that can express at least:

- stable property/capability identifier
- display metadata or translation key strategy
- value type / allowed values
- whether the value is readable
- whether the value is writable
- optional validation constraints
- optional grouping/order metadata if the provider wants to influence presentation

AEM must not require a fixed list of fields. Future provider versions may add properties without AEM treating them as invalid merely because their identifiers are new.

The examples discussed during design (AI alias, read/control permission, bulk turn-off policy, protection, confirmation, semantic role, announcement priority, etc.) are **examples only** and are not part of this contract until Semantic Control defines them.

**Exact schema shape: TBD.**

### 4. Read current provider-owned entity data

AEM needs a way to obtain the current Semantic-Control-owned values for a Home Assistant entity.

Requirements:

- entity identity must use the Home Assistant entity identity or an explicitly documented stable mapping
- values returned must correspond to the published capability/schema information
- missing optional values must remain missing; AEM must not invent defaults unless the provider schema explicitly defines a default
- Home Assistant remains the source for normal entity/device/area/state information

**Exact request/response mechanism: TBD.**

### 5. Write mutable provider-owned entity data

For properties declared writable by the provider, AEM needs a validated write mechanism.

Requirements:

- partial updates should be possible, or the contract must clearly define safe replacement semantics
- unsupported/read-only properties must be rejected by the provider
- provider remains source of truth after the write
- AEM should use the provider's returned/current value rather than maintaining a second policy copy

**Exact write mechanism: TBD.**

### 6. Error format

The adapter needs enough structured error information to distinguish at least:

- temporarily unavailable
- incompatible contract
- invalid request/value
- permission denied
- entity not known to provider
- capability no longer available

Human-readable detail is useful, but AEM should not depend on parsing prose to determine error type.

**Exact error codes/shape: TBD.**

### 7. Refresh / invalidation

AEM needs to know when cached capability/schema/entity data is stale.

Acceptable designs could include one or more of:

- documented refresh command
- provider event/change signal
- coordinator/update timestamp exposed through a supported interface
- deliberately short-lived reads with no cache

AEM does not currently assume any one of these approaches.

**Mechanism: TBD.**

## Ownership rules

### Home Assistant owns

- areas
- devices
- entities
- entity registry metadata
- states and standard attributes

### Assist Semantic Control should own

- AI-specific capabilities
- AI-specific entity metadata
- AI policies and their current values
- validation/default semantics for those properties

### AEM owns

- presentation/management UI
- the AEM-only setting `use_semantic_control_extensions`
- AEM's internal adapter API version

AEM must not persist a duplicate authoritative copy of Semantic Control policy data.

## Current AEM internal adapter boundary

`semantic_provider.py` currently exposes an AEM-internal adapter protocol with operations equivalent to:

- obtain a normalized provider snapshot
- read provider-owned entity data
- write provider-owned entity data

These names are implementation details inside AEM. A future adapter may translate any suitable real Semantic Control interface into them.

The current AEM internal adapter API version is `1`. This number **does not claim that Assist Semantic Control has an API version 1**.

## Integration rule

Do not bind a production adapter to Assist Semantic Control until the Semantic Control project provides an agreed, documented, real interface that satisfies the minimum abilities above.
