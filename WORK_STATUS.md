# Work status

## Scope

Prepare Assist Entity Manager (AEM) for a future, optional Assist Semantic Control provider without implementing or inventing the external Semantic Control API, and keep the existing AEM entity-management UI reliable while this preparation is integrated.

## Verified current state before this work

Repository tree was inspected recursively.

- No `AGENTS.md` existed in the repository before this work.
- No previous `WORK_STATUS.md` existed.
- No dedicated project/feature specification was present beyond README files and the existing code/workflow.
- No `tests/` directory or unit/integration test suite existed before this work.
- CI originally contained HACS validation and Home Assistant Hassfest validation only.
- AEM backend originally registered static frontend resources and the sidebar panel but exposed no AEM-owned WebSocket commands.
- The config flow is a single empty/single-instance setup flow.
- Existing AEM UI preferences/change-watch/view state are browser `localStorage`/`sessionStorage` data.
- Home Assistant registry/state WebSocket APIs are the source for areas, devices, entities, states, aliases and voice-assistant exposure data.
- The English and German frontend implementations are large separate language bundles loaded by the small common loader.
- No Assist Semantic Control production integration, provider adapter or external contract exists in this repository.

## Completed Semantic Control preparation

Original branch: `feature/semantic-control-provider-prep` (merged as PR #1)

- Added `semantic_provider.py` as a narrow AEM-internal optional-provider boundary.
- Added a versioned **internal AEM adapter API** (`1`). This is not an external Semantic Control API version.
- Added normalized safe provider states: disabled, not available, compatible, incompatible, unavailable, incomplete.
- Added explicit containment for adapter failure and incompatible internal adapter versions.
- Added provider read/write gates that refuse access when the AEM Semantic Control extension switch is off.
- Added AEM-owned persistent settings storage using Home Assistant `Store`.
- Persisted only the AEM setting `use_semantic_control_extensions`; no Semantic Control policy data is duplicated.
- Added admin-only AEM WebSocket settings commands:
  - `assist_entity_manager/settings/get`
  - `assist_entity_manager/settings/update`
- The commands above are AEM's own administration interface. They are not claimed to be Semantic Control endpoints.
- Added a hidden admin/developer panel in the common AEM sidebar loader:
  - five clicks on the small AEM version label unlock it for the current frontend instance
  - frontend also checks the current HA user admin flag
  - backend WebSocket commands independently enforce Home Assistant admin permission
  - a persistent switch enables/disables AEM's future Semantic Control extensions
  - no provider refresh button is exposed because no real external refresh contract exists yet
- Added `SEMANTIC_CONTROL_PROVIDER_CONTRACT.md`.
- Added pure adapter-boundary tests using controlled test doubles only.
- Added the unit suite to the validation workflow.

## Completed AEM 1.1.1 follow-up

Branch: `fix/auto-refresh-and-english-localization` (merged as PR #2)

- Added debounced automatic AEM data refresh for:
  - `entity_registry_updated`
  - `device_registry_updated`
  - `area_registry_updated`
  - entity creation/removal observed through `state_changed` where old or new state is missing
- Refresh resets the alias index as well as the primary loaded-data flag before reloading, so alias/conflict data cannot remain stale after registry changes.
- Subscriptions are cleaned up when the card/panel disconnects and are rebound when the Home Assistant connection changes.
- Added an English-only compatibility cleanup layer in the common loader for mixed German/English strings already observed in the `en` bundle.
- Added regression tests for refresh hooks and English fallback fixes.
- Added Node syntax checks for frontend JavaScript to CI.
- PR #2 validation passed: unit tests, JavaScript syntax, Hassfest and HACS.

## AEM 1.1.2 follow-up in progress

Branch: `fix/orphaned-entities-and-english-guard`

### Verified root cause: deleted entities remaining visible

Real Home Assistant Core behavior was checked before changing AEM:

- `config/entity_registry/list_for_display` returns all non-disabled Entity Registry entries that have display data.
- A registry entry can therefore still be returned even when no current Home Assistant state exists for that entity.
- AEM's language bundles intentionally built the visible ID set as the union of:
  - every current `hass.states` entity ID, and
  - every entity ID returned by `config/entity_registry/list_for_display`.

As a result, a removed Template entity whose registry entry still existed could continue to appear in AEM after a correct refresh. The v1.1.1 refresh mechanism was therefore functioning; the visible-entity selection rule itself was the remaining problem.

### Implemented for 1.1.2

- Added `frontend/aem-runtime-fixes.js` as a contained compatibility layer while the two large language bundles remain separate.
- The runtime layer applies the same active-entity guard to the German and English AEM elements.
- Before change-watch processing, AEM now removes entries from its visible entity collection when the entity ID is not present in current `hass.states`.
- Selected IDs and an open details panel are cleaned up when their entity disappears.
- Alias/conflict caches are invalidated if orphan filtering changed the list.
- Existing AEM instances are reloaded when the runtime guard is installed, so stale rows do not require a second manual reload.
- Existing registry/state event subscriptions from 1.1.1 remain responsible for future automatic refreshes.
- Extended the English-only cleanup to cover additional mixed strings verified in the actual English bundle, including `Schloss`/`Wasser`, external-change descriptions and previously observed UI labels.
- Added a targeted English device-class guard for the two verified leftovers.
- Added the runtime file as a versioned Home Assistant frontend resource.
- Bumped backend/manifest patch version to `1.1.2`.
- Extended regression tests to cover orphan filtering in both language bundles and the additional English cleanup.

### Active-entity decision

For the normal AEM entity-management list, an entity is considered currently manageable only when it has a current Home Assistant state. Registry metadata is still used to enrich active entities, but a registry-only entry is no longer sufficient to put an entity into AEM's main list.

Trade-off: a registry entry whose integration is temporarily unable to create its entity state will be hidden from AEM until the state exists again. This is intentional for the active voice-control management view and avoids presenting removed/orphaned entities as usable devices.

AEM does not delete or modify the underlying Home Assistant Entity Registry entry as part of this filtering.

## Architecture decisions

### Source of truth

- Home Assistant: areas, devices, entities, registry metadata, states, standard attributes.
- Future Assist Semantic Control: AI-specific metadata, capabilities, policies and current provider-owned values.
- AEM: management UI, adapter/facade, AEM-only compatibility settings.

AEM must not persist a second authoritative copy of future Semantic Control policy data.

### No invented Semantic Control API

No production adapter is registered. The manager therefore reports that no compatible AEM adapter is currently available when the extension switch is on.

The internal adapter protocol is only an AEM implementation seam. It deliberately does not prescribe external service names, WebSocket paths, events, storage keys, integration domains or schema field names.

### Dynamic capabilities/schema

The normalized provider snapshot can carry capability identifiers and an opaque schema mapping without a hard-coded Semantic Control field list. A concrete future adapter is responsible for validating the real external contract before returning a `compatible` snapshot.

### Disabled mode

When `use_semantic_control_extensions` is false:

- provider status does not call the adapter
- provider entity reads are blocked before adapter access
- provider entity writes are blocked before adapter access
- the current UI exposes no Semantic-Control-specific entity fields
- the Semantic Control integration itself is not modified

### Hidden admin UI

The five-click trigger is only a discoverability mechanism, not a security boundary. The AEM backend enforces admin access to the persistent setting.

### Live Home Assistant data

AEM remains a registry/state consumer, not a second entity store. Registry metadata enriches current states. Automatic refresh reacts to Home Assistant registry changes and entity creation/removal; ordinary state value changes do not trigger expensive full registry reloads.

## Tests and actual results

Semantic provider coverage includes:

- AEM provider manager without a provider
- disabled provider path does not call adapter
- compatible provider snapshot with unknown/future capability and schema property
- missing optional schema/capabilities are not fabricated
- incompatible internal adapter API version
- provider exception/outage containment
- unknown provider state is not blindly accepted
- enabled reads/writes delegate through the adapter

Previously verified results:

- Original provider unit run: **8 tests passed**.
- GitHub Actions run `32184689335`: `unit`, `hassfest`, and `hacs` all **passed**.
- PR #2 / v1.1.1 validation: unit/regression tests, frontend JavaScript syntax, Hassfest and HACS all **passed**.

1.1.2 regression coverage now includes:

- registry events schedule an AEM refresh
- entity creation/removal state events schedule a refresh
- alias index is invalidated before reload
- orphaned registry entries are filtered using current Home Assistant states
- orphan filtering is installed for both German and English bundles
- additional reported/verified English fallback strings are covered
- runtime compatibility version is checked as `1.1.2`
- CI's existing Node wildcard syntax check includes the new runtime JavaScript file

Actual CI results for the 1.1.2 branch are pending until the branch PR run completes.

## Open work

- Run the 1.1.2 branch CI and correct any failure.
- Test the 1.1.2 orphan-filter behavior in the user's real Home Assistant runtime.
- Test the hidden admin/developer menu against a real Home Assistant frontend/runtime.
- Verify the AEM-owned setting persists across a real Home Assistant restart/reload.
- Once Assist Semantic Control defines a real public contract, implement a concrete AEM-side adapter against that contract.
- Only then add schema-driven Semantic Control entity controls to the main AEM entity/details UI.
- Long term, replace the two large embedded-string language bundles with a shared translation-key architecture; the current English compatibility cleanup is deliberately a contained patch, not the desired final localization architecture.

## Not verified

- The future Assist Semantic Control integration domain is not defined here and is intentionally not guessed.
- The future external provider transport/API names are unknown.
- The future external contract-version format and compatibility rules are unknown.
- The future schema/capability wire format is unknown.
- A concrete refresh/invalidation mechanism for Semantic Control itself is unknown.
- Full runtime behavior of the hidden admin panel still requires real Home Assistant testing.
- The 1.1.2 orphan filter has regression coverage but still requires real Home Assistant runtime confirmation after installation.

## Risks

- The current AEM frontend uses two large language-specific bundles with embedded strings. Future dynamic provider fields should avoid duplicating provider logic across both bundles if possible.
- The English compatibility cleanup covers verified mixed strings, but a future translation refactor is safer than indefinitely expanding replacement rules.
- Active-state filtering intentionally hides registry-only entries, including entries temporarily lacking a state.
- Provider schema rendering must be designed carefully once the real schema exists; accepting an unknown field identifier is different from accepting an unknown/unsafe schema contract version.
- The production adapter must not bind to undocumented internal objects of Assist Semantic Control unless both projects explicitly accept that compatibility risk.
- AEM's persistent Semantic Control switch is installation-level AEM state; this is intentional. Semantic Control policy values must remain provider-owned.

## Required interface from Assist Semantic Control project

See `SEMANTIC_CONTROL_PROVIDER_CONTRACT.md`. In short, the future project needs to agree a real supported mechanism for:

- provider detection
- explicit contract compatibility/version information
- capability/schema retrieval
- provider-owned entity-data reads
- provider-owned mutable entity-data writes
- structured errors
- refresh/invalidation or equivalent freshness rules
