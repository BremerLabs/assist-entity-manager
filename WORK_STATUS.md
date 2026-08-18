# Work status

## Scope

Prepare Assist Entity Manager (AEM) for a future, optional Assist Semantic Control provider without implementing or inventing the external Semantic Control API.

## Verified current state before this work

Repository tree was inspected recursively.

- No `AGENTS.md` exists in the repository.
- No previous `WORK_STATUS.md` existed.
- No dedicated project/feature specification was present beyond README files and the existing code/workflow.
- No `tests/` directory or unit/integration test suite existed.
- CI contained HACS validation and Home Assistant Hassfest validation only.
- AEM backend registered static frontend resources and the sidebar panel but exposed no AEM-owned WebSocket commands.
- The config flow was a single empty/single-instance setup flow.
- Existing AEM UI preferences/change-watch/view state were browser `localStorage`/`sessionStorage` data.
- Home Assistant registry/state WebSocket APIs were already the source for areas, devices, entities, states, aliases and voice-assistant exposure data.
- The English and German frontend implementations are large separate language bundles loaded by the small common loader.
- No Assist Semantic Control production integration, provider adapter or external contract exists in this repository.

## Completed in this branch

Branch: `feature/semantic-control-provider-prep`

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
- Bumped the development branch to AEM `1.1.0` and added `websocket_api` as a manifest dependency.
- Added `SEMANTIC_CONTROL_PROVIDER_CONTRACT.md`.
- Added pure adapter-boundary tests using controlled test doubles only.
- Added the unit suite to the existing validation workflow.

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

## Tests and actual results

Tests added:

- AEM provider manager without a provider
- disabled provider path does not call adapter
- compatible provider snapshot with unknown/future capability and schema property
- missing optional schema/capabilities are not fabricated
- incompatible internal adapter API version
- provider exception/outage containment
- unknown provider state is not blindly accepted
- enabled reads/writes delegate through the adapter

Actual results:

- Local stdlib unit run: **8 tests passed**.
- Local Python syntax compilation for the pure provider module/tests: **passed**.
- GitHub Actions run `32184689335`:
  - `unit`: **passed**
  - `hassfest`: **passed**
  - `hacs`: **passed**
- The WebSocket admin-decorator order was checked against current Home Assistant Core usage and corrected before the successful Hassfest run.

## Open work

- Test the hidden admin/developer menu against a real Home Assistant frontend/runtime.
- Verify the AEM-owned setting persists across a real Home Assistant restart/reload, in addition to the storage implementation and unit-level provider gating already checked.
- Once Assist Semantic Control defines a real public contract, implement a concrete AEM-side adapter against that contract.
- Only then add schema-driven Semantic Control entity controls to the main AEM entity/details UI.

## Not verified

- The future Assist Semantic Control integration domain is not defined here and is intentionally not guessed.
- The future external provider transport/API names are unknown.
- The future external contract-version format and compatibility rules are unknown.
- The future schema/capability wire format is unknown.
- A concrete refresh/invalidation mechanism is unknown.
- Frontend use of `hass.user.is_admin` is treated as a UI convenience only; authorization does not rely on it because the backend uses Home Assistant's admin WebSocket guard.
- Full runtime behavior of the new admin panel has not yet been exercised in a real Home Assistant instance at the time of this status entry.

## Risks

- The current AEM frontend uses two large language-specific bundles with embedded strings. Future dynamic provider fields should avoid duplicating provider logic across both bundles if possible.
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
