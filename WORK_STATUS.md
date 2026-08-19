# Work status

## Scope

Prepare Assist Entity Manager (AEM) for a future, optional Assist Semantic Control provider without inventing the external Semantic Control API, while keeping existing AEM entity management reliable.

## Verified baseline

- No `AGENTS.md`, `WORK_STATUS.md`, project specification or tests existed before this work.
- AEM originally had no AEM-owned WebSocket API.
- Home Assistant remains the source of truth for areas, devices, entities, states, aliases and assistant exposure.
- The English and German frontends are still separate large bundles loaded by the common loader.
- No production Assist Semantic Control integration or final external contract exists in this repository.

## Completed Semantic Control preparation

Merged as PR #1.

- Added the optional provider/adapter boundary.
- Added persistent AEM setting `use_semantic_control_extensions`.
- Added admin-only AEM settings WebSocket commands.
- Added hidden admin/developer UI unlocked by five clicks on the AEM version label.
- Added provider contract documentation and provider compatibility tests.
- No Semantic Control API, service, event, storage key or capability field was invented.

## Completed AEM 1.1.1 follow-up

Merged as PR #2.

- Added automatic refresh for entity/device/area registry changes and entity create/remove state events.
- Alias/conflict data is invalidated and reloaded after relevant changes.
- Added English compatibility cleanup for reported mixed German/English UI strings.
- Added frontend regression tests and JavaScript syntax validation.
- Unit tests, JavaScript syntax, Hassfest and HACS passed.

## AEM 1.1.2 follow-up in progress

Branch: `fix/orphaned-entities-and-english-guard`
PR: #4

### Verified root cause

`config/entity_registry/list_for_display` may still return a non-disabled Entity Registry entry even when that entity no longer has a current Home Assistant state. AEM previously built its visible list from the union of current states and registry entries, so stale Template/helper entries could remain visible after a correct refresh.

### Current 1.1.2 design

The earlier plan to silently hide registry-only entities was replaced after deciding that users need a safe way to clean these stale entries instead of merely concealing them.

Implemented:

- registry-only entries are marked as `orphaned` in AEM when no current `hass.states` entry exists
- orphaned entities remain manageable and are visually marked as `Verwaist` / `Orphaned`
- every entity detail gets an entity-cleanup section
- for orphaned entities the action `Restlos aus Home Assistant löschen` / `Permanently remove from Home Assistant` is enabled
- destructive cleanup requires explicit user confirmation
- active entities show the cleanup section but the destructive action is disabled and explains that the actual integration/YAML/helper source must be removed first
- added AEM-owned admin-only WebSocket command `assist_entity_manager/entity/remove_orphan`
- backend independently verifies that the Entity Registry entry exists and that no current Home Assistant state exists
- backend refuses active entities even if the frontend is bypassed
- successful cleanup removes the stale Entity Registry entry with Home Assistant's registry API and refreshes AEM
- the cleanup command does not remove devices, config entries, integrations, YAML files or helpers
- existing automatic registry/state refresh from 1.1.1 remains active

### Important semantics of “permanently remove”

For a truly orphaned Entity Registry entry, AEM can remove the registry record completely.

For an active source-managed entity, AEM cannot truthfully guarantee permanent deletion because its integration, YAML definition or helper can recreate the entity. Such entities must first be removed at their real source. AEM therefore deliberately refuses destructive registry deletion while an active state exists.

### English localization

- additional verified English leftovers are handled, including `Schloss` → `Lock` and `Wasser` → `Water`
- mixed external-change descriptions are corrected in the English runtime only
- German UI remains unchanged

### Version

- target version remains `1.1.2`
- backend/manifest/runtime version is `1.1.2`

## Source-of-truth decisions

- Home Assistant: areas, devices, entities, registry metadata, states and standard attributes
- future Assist Semantic Control: AI-specific metadata, capabilities and policies
- AEM: management UI, provider facade and AEM-only settings

AEM must not persist a second authoritative copy of Semantic Control policy data.

## Safety decisions

- hidden UI is not a security boundary
- Semantic Control settings and orphan cleanup are protected server-side with Home Assistant admin checks
- AEM does not delete an active source-managed entity from the Entity Registry
- no automatic bulk orphan deletion is performed
- every orphan cleanup is explicit and confirmed by the user

## Tests

Existing coverage:

- provider unavailable/disabled/compatible/incompatible/outage cases
- unknown capability and optional-field handling
- registry refresh subscriptions
- entity create/remove refresh
- alias-index invalidation
- English fallback checks
- JavaScript syntax validation

1.1.2 coverage now additionally checks:

- orphaned entries are marked instead of silently filtered
- cleanup UI is installed for both German and English bundles
- cleanup UI requires explicit confirmation
- AEM uses `assist_entity_manager/entity/remove_orphan`
- backend command is admin-only
- backend refuses an entity while `hass.states` still contains it
- backend removes only the Entity Registry entry for a verified orphan

Previously verified CI:

- provider preparation: unit, Hassfest and HACS passed
- v1.1.1 follow-up: unit/regression tests, JavaScript syntax, Hassfest and HACS passed

Current v1.1.2 CI must be rechecked after the cleanup changes.

## Open work

- run and verify updated PR #4 CI
- test orphan marking and cleanup against the user's real Home Assistant instance
- verify successful removal of the old demo/template registry leftovers
- test hidden admin/developer menu and persistent Semantic Control switch in real HA
- when Assist Semantic Control defines its real contract, implement the concrete AEM adapter and schema-driven UI
- long term, replace embedded language bundles with a shared translation-key architecture

## Not verified

- future Semantic Control integration domain and external transport/API
- future contract-version and capability wire format
- Semantic Control refresh/invalidation mechanism
- real HA runtime behavior of the new orphan cleanup until installed and tested

## Risks

- an integration that temporarily lacks a state may look orphaned even though it can recover later; cleanup therefore remains manual and explicitly confirmed
- removing the source after deleting an active entity is essential; otherwise the source may recreate it
- English compatibility replacement is a containment patch, not the desired long-term localization architecture

## Required interface from Assist Semantic Control

See `SEMANTIC_CONTROL_PROVIDER_CONTRACT.md` for the still-to-be-agreed provider detection, compatibility/version information, capability/schema retrieval, provider-owned reads/writes, structured errors and freshness/invalidations.
