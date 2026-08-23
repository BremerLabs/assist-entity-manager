/*
 * Assist Entity Manager
 * HACS-ready Home Assistant dashboard card
 * Version 1.0.0
 *
 * Uses Home Assistant's authenticated WebSocket APIs only.
 */

const AEM_BACKUP_SCHEMA_VERSION = 2;
const AEM_BACKUP_MIN_SCHEMA_VERSION = 1;

class AssistEntityManager extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._loaded = false;
    this._loading = false;
    this._error = "";
    this._entities = [];
    this._areas = new Map();
    this._devices = new Map();
    this._exposed = {};
    this._selected = new Set();
    this._searchTimer = null;
    this._page = 1;
    this._pageSize = 40;
    this._detailEntityId = null;
    this._detailRegistry = null;
    this._detailLoading = false;
    this._detailError = "";
    this._excludedPlatforms = new Set();
    this._excludeDropdownOpen = false;
    this._cloudStatus = null;
    this._activeAssistants = [];
    this._assistantSupport = new Map();
    this._assistantSupportLoading = false;
    this._bulkAssistant = "conversation";
    this._actionNotice = "";
    this._aliasSaving = false;
    this._aliasError = "";
    this._aliasSuccess = "";
    this._assignmentSaving = "";
    this._assignmentError = "";
    this._assignmentSuccess = "";
    this._aliasIndexReady = false;
    this._aliasIndexLoading = false;
    this._aliasIndexError = "";
    this._spokenNameIndex = new Map();
    this._groupByDevice = true;
    this._expandedGroups = new Set();
    this._groupPageSize = 15;
    this._conflictGroupsCache = [];
    this._conflictEntityIds = new Set();
    this._conflictsByEntity = new Map();
    this._specialView = "";
    this._qualityfilter = "";
    this._utilityPanel = "";
    this._externalChanges = [];
    this._changeWatchReady = false;
    this._preferences = this._readPreferences();
    this._importPreview = null;
    this._importFileName = "";
    this._importBusy = false;
    this._importError = "";
    this._importSuccess = "";
    this._exportBusy = false;
    this._outsideClickHandler = (event) => this._handleDocumentClick(event);
    this._filters = {
      search: "",
      area: "",
      domain: "",
      status: "",
      category: "",
    };
    this._pendingViewState = this._readViewState();
  }

  _viewStateStorageKey() {
    const path = window.location?.pathname || "/";
    return `assist-entity-manager:view-state:v1:${path}`;
  }

  _readViewState() {
    try {
      const raw = window.sessionStorage?.getItem(this._viewStateStorageKey());
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      console.warn("Assist Entity Manager: view state could not be read", err);
      return null;
    }
  }

  _saveViewState() {
    if (!this._loaded) return;

    const state = {
      version: 1,
      filters: {
        search: this._filters.search || "",
        area: this._filters.area || "",
        domain: this._filters.domain || "",
        status: this._filters.status || "",
        category: this._filters.category || "",
      },
      excludedPlatforms: [...this._excludedPlatforms],
      groupByDevice: Boolean(this._groupByDevice),
      page: Number.isInteger(this._page) && this._page > 0 ? this._page : 1,
      bulkAssistant: this._bulkAssistant || "",
      expandedGroups: [...this._expandedGroups],
      specialView: this._specialView || "",
      qualityfilter: this._qualityfilter || "",
    };

    try {
      window.sessionStorage?.setItem(
        this._viewStateStorageKey(),
        JSON.stringify(state)
      );
    } catch (err) {
      console.warn("Assist Entity Manager: view state could not be saved", err);
    }
  }

  _applyPendingViewState() {
    const state = this._pendingViewState;
    this._pendingViewState = null;

    if (!state || typeof state !== "object") return;

    const filters =
      state.filters && typeof state.filters === "object"
        ? state.filters
        : {};

    const validAreas = new Set(this._areas.keys());
    const validDomains = new Set(this._entities.map((entity) => entity.domain));
    const validStatuses = new Set(["", "exposed", "not_exposed"]);
    const validCategories = new Set(["", "normal", "config", "diagnostic"]);

    if (typeof filters.search === "string") {
      this._filters.search = filters.search;
    }

    if (
      filters.area === "" ||
      filters.area === "__none__" ||
      (typeof filters.area === "string" && validAreas.has(filters.area))
    ) {
      this._filters.area = filters.area || "";
    }

    if (
      filters.domain === "" ||
      (typeof filters.domain === "string" && validDomains.has(filters.domain))
    ) {
      this._filters.domain = filters.domain || "";
    }

    if (validStatuses.has(filters.status || "")) {
      this._filters.status = filters.status || "";
    }

    if (validCategories.has(filters.category || "")) {
      this._filters.category = filters.category || "";
    }

    if (Array.isArray(state.excludedPlatforms)) {
      this._excludedPlatforms = new Set(
        state.excludedPlatforms.filter(
          (platform) => typeof platform === "string" && platform
        )
      );
    }

    if (typeof state.groupByDevice === "boolean") {
      this._groupByDevice = state.groupByDevice;
    }

    if (Number.isInteger(state.page) && state.page > 0) {
      this._page = state.page;
    }

    if (
      typeof state.bulkAssistant === "string" &&
      this._activeAssistants.some(
        (assistant) => assistant.id === state.bulkAssistant
      )
    ) {
      this._bulkAssistant = state.bulkAssistant;
    }

    if (Array.isArray(state.expandedGroups)) {
      this._expandedGroups = new Set(
        state.expandedGroups.filter(
          (key) => typeof key === "string" && key
        )
      );
    }

    if (state.specialView === "conflicts") {
      this._specialView = "conflicts";
    }

    if (
      state.qualityfilter === "ambiguous" ||
      state.qualityfilter === "external_changes"
    ) {
      this._qualityfilter = state.qualityfilter;
    }
  }

  _changeWatchStorageKey() {
    return "assist-entity-manager:change-watch:v1";
  }

  _readChangeWatchState() {
    try {
      const raw = window.localStorage?.getItem(this._changeWatchStorageKey());
      if (!raw) return { version: 1, snapshot: null, changes: [] };

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid saved change state");
      }

      return {
        version: 1,
        snapshot:
          parsed.snapshot && typeof parsed.snapshot === "object"
            ? parsed.snapshot
            : null,
        changes: Array.isArray(parsed.changes)
          ? parsed.changes.filter(
              (change) =>
                change &&
                typeof change === "object" &&
                typeof change.id === "string"
            )
          : [],
      };
    } catch (err) {
      console.warn(
        "Assist Entity Manager: change state could not be read",
        err
      );
      return { version: 1, snapshot: null, changes: [] };
    }
  }

  _saveChangeWatchState(snapshot, changes = this._externalChanges) {
    try {
      window.localStorage?.setItem(
        this._changeWatchStorageKey(),
        JSON.stringify({
          version: 1,
          snapshot,
          changes: Array.isArray(changes) ? changes.slice(-50) : [],
        })
      );
    } catch (err) {
      console.warn(
        "Assist Entity Manager: change state could not be saved",
        err
      );
    }
  }

  _buildChangeWatchSnapshot() {
    const assistantIds = this._assistantIds();
    const entities = {};

    for (const entity of this._entities) {
      entities[entity.entityId] = {
        name: entity.name || entity.entityId,
        areaName: entity.areaName || "",
        exposure: Object.fromEntries(
          assistantIds.map((assistantId) => [
            assistantId,
            this._exposureState(entity.entityId, assistantId) === "exposed",
          ])
        ),
        support: Object.fromEntries(
          assistantIds.map((assistantId) => [
            assistantId,
            this._assistantSupportState(assistantId, entity.entityId),
          ])
        ),
      };
    }

    return {
      capturedAt: new Date().toISOString(),
      assistants: assistantIds,
      entities,
    };
  }

  _changeAssistantLabel(assistantId) {
    return this._assistantById(assistantId)?.label || assistantId;
  }

  _processExternalChanges() {
    const stored = this._readChangeWatchState();
    const previous = stored.snapshot;
    const current = this._buildChangeWatchSnapshot();
    const changes = [...stored.changes];
    const detectedAt = new Date().toISOString();
    let sequence = 0;

    const addChange = (change) => {
      sequence += 1;
      changes.push({
        id: `${Date.now()}-${sequence}`,
        detectedAt,
        ...change,
      });
    };

    if (previous?.entities && Array.isArray(previous.assistants)) {
      const previousAssistants = new Set(previous.assistants);
      const currentAssistants = new Set(current.assistants);
      const comparableAssistants = [...currentAssistants].filter((assistantId) =>
        previousAssistants.has(assistantId)
      );

      for (const [entityId, currentEntity] of Object.entries(current.entities)) {
        const previousEntity = previous.entities?.[entityId];
        if (!previousEntity) continue;

        for (const assistantId of comparableAssistants) {
          const before = Boolean(previousEntity.exposure?.[assistantId]);
          const after = Boolean(currentEntity.exposure?.[assistantId]);

          if (before !== after) {
            addChange({
              kind: "exposure",
              entityId,
              entityName: currentEntity.name || previousEntity.name || entityId,
              areaName: currentEntity.areaName || previousEntity.areaName || "",
              assistantId,
              before,
              after,
            });
          }

          const previousSupport = previousEntity.support?.[assistantId] || "unknown";
          const currentSupport = currentEntity.support?.[assistantId] || "unknown";

          if (
            previousSupport === "supported" &&
            currentSupport === "unsupported"
          ) {
            addChange({
              kind: "support",
              entityId,
              entityName: currentEntity.name || previousEntity.name || entityId,
              areaName: currentEntity.areaName || previousEntity.areaName || "",
              assistantId,
              beforeSupport: previousSupport,
              afterSupport: currentSupport,
            });
          }
        }
      }

      for (const [entityId, previousEntity] of Object.entries(
        previous.entities || {}
      )) {
        if (current.entities[entityId]) continue;

        const previouslyExposedTo = comparableAssistants.filter(
          (assistantId) => Boolean(previousEntity.exposure?.[assistantId])
        );

        if (previouslyExposedTo.length) {
          addChange({
            kind: "missing",
            entityId,
            entityName: previousEntity.name || entityId,
            areaName: previousEntity.areaName || "",
            assistantIds: previouslyExposedTo,
          });
        }
      }
    }

    this._externalChanges = changes.slice(-50);
    this._changeWatchReady = true;
    this._saveChangeWatchState(current, this._externalChanges);
  }

  _updateChangeWatchBaseline() {
    if (!this._entities.length) return;

    const stored = this._readChangeWatchState();
    this._externalChanges = Array.isArray(stored.changes)
      ? stored.changes.slice(-50)
      : this._externalChanges;

    this._saveChangeWatchState(
      this._buildChangeWatchSnapshot(),
      this._externalChanges
    );
    this._changeWatchReady = true;
  }

  _acknowledgeExternalChanges() {
    this._externalChanges = [];
    this._qualityfilter = "";
    this._page = 1;
    this._saveChangeWatchState(this._buildChangeWatchSnapshot(), []);
    this._render();
  }

  _externalChangesForEntity(entityId) {
    return this._externalChanges.filter(
      (change) => change.entityId === entityId
    );
  }

  _externalChangeEntityIds() {
    return new Set(
      this._externalChanges
        .map((change) => change.entityId)
        .filter((entityId) =>
          this._entities.some((entity) => entity.entityId === entityId)
        )
    );
  }

  _externalChangeDescription(change) {
    if (!change) return "";

    if (change.kind === "exposure") {
      return `${this._changeAssistantLabel(change.assistantId)}: exposure was changed outside Assist Manager ${
        change.after ? "aktiviert" : "deaktiviert"
      }.`;
    }

    if (change.kind === "support") {
      return `${this._changeAssistantLabel(
        change.assistantId
      )}: Home Assistant meldet diese Entity jetzt als not supported.`;
    }

    if (change.kind === "missing") {
      const assistants = (change.assistantIds || [])
        .map((assistantId) => this._changeAssistantLabel(assistantId))
        .join(", ");
      return `The entity is currently no longer present in the Entity Registry. It was previously exposed to ${
        assistants || "einen Voice assistants"
      } exposed.`;
    }

    return "A change outside Assist Manager was detected.";
  }

  _formatChangeTime(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat(this._hass?.language || "de-DE", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value));
    } catch (_err) {
      return "";
    }
  }

  _preferencesStorageKey() {
    return "assist-entity-manager:preferences:v1";
  }

  _readPreferences() {
    const defaults = {
      detectUnnecessary: true,
      hideUnnecessary: false,
      detectAmbiguousNames: true,
      ignoredConflictEntityIds: [],
    };

    try {
      const raw = window.localStorage?.getItem(this._preferencesStorageKey());
      if (!raw) return defaults;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaults;

      return {
        detectUnnecessary:
          typeof parsed.detectUnnecessary === "boolean"
            ? parsed.detectUnnecessary
            : defaults.detectUnnecessary,
        hideUnnecessary:
          typeof parsed.hideUnnecessary === "boolean"
            ? parsed.hideUnnecessary
            : defaults.hideUnnecessary,
        detectAmbiguousNames:
          typeof parsed.detectAmbiguousNames === "boolean"
            ? parsed.detectAmbiguousNames
            : defaults.detectAmbiguousNames,
        ignoredConflictEntityIds: Array.isArray(parsed.ignoredConflictEntityIds)
          ? [...new Set(
              parsed.ignoredConflictEntityIds.filter(
                (entityId) => typeof entityId === "string" && entityId
              )
            )]
          : defaults.ignoredConflictEntityIds,
      };
    } catch (err) {
      console.warn("Assist Entity Manager: settings could not be read", err);
      return defaults;
    }
  }

  _savePreferences() {
    try {
      window.localStorage?.setItem(
        this._preferencesStorageKey(),
        JSON.stringify(this._preferences)
      );
    } catch (err) {
      console.warn("Assist Entity Manager: settings could not be saved", err);
    }
  }

  _isConflictIgnored(entityId) {
    return (this._preferences.ignoredConflictEntityIds || []).includes(entityId);
  }

  _setConflictIgnored(entityId, ignored) {
    if (!entityId) return;

    const current = new Set(this._preferences.ignoredConflictEntityIds || []);
    if (ignored) current.add(entityId);
    else current.delete(entityId);

    this._preferences.ignoredConflictEntityIds = [...current].sort();
    this._savePreferences();

    if (this._aliasIndexReady) {
      this._rebuildSpokenNameIndex();
    }

    this._render();
  }

  _clearIgnoredConflicts() {
    this._preferences.ignoredConflictEntityIds = [];
    this._savePreferences();

    if (this._aliasIndexReady) {
      this._rebuildSpokenNameIndex();
    }

    this._render();
  }

  connectedCallback() {
    document.addEventListener("click", this._outsideClickHandler, true);
  }

  disconnectedCallback() {
    document.removeEventListener("click", this._outsideClickHandler, true);
    clearTimeout(this._searchTimer);
  }

  _handleDocumentClick(event) {
    const dropdown = this.shadowRoot?.querySelector(".exclude-dropdown");
    if (!dropdown?.open) return;

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(dropdown)) return;

    dropdown.open = false;
    this._excludeDropdownOpen = false;
  }

  _componentLoaded(component) {
    const components = this._hass?.config?.components;
    if (Array.isArray(components)) return components.includes(component);
    if (components && typeof components.has === "function") return components.has(component);
    return false;
  }

  _assistantIconMarkup(assistant, extraClass = "") {
    const cls = extraClass ? ` ${extraClass}` : "";

    if (assistant?.id === "cloud.alexa") {
      return `<span class="assistant-custom-icon assistant-custom-icon-alexa${cls}" aria-hidden="true">a</span>`;
    }

    if (assistant?.id === "cloud.google_assistant") {
      return `<span class="assistant-custom-icon assistant-custom-icon-google${cls}" aria-hidden="true">
        <span class="ga-dot ga-dot-lg"></span>
        <span class="ga-dot ga-dot-sm ga-dot-top"></span>
        <span class="ga-dot ga-dot-sm ga-dot-bottom"></span>
      </span>`;
    }

    return `<ha-icon icon="${assistant?.icon || 'mdi:account-voice'}"></ha-icon>`;
  }

  _assistantCatalog() {
    return [
      {
        id: "conversation",
        label: "Assist",
        shortLabel: "Assist",
        icon: "mdi:message-processing-outline",
      },
      {
        id: "cloud.alexa",
        label: "Amazon Alexa",
        shortLabel: "Alexa",
        icon: "mdi:amazon-alexa",
      },
      {
        id: "cloud.google_assistant",
        label: "Google Assistant",
        shortLabel: "Google",
        icon: "mdi:google-assistant",
      },
    ];
  }

  _deriveActiveAssistants() {
    const active = [];
    const catalog = this._assistantCatalog();

    if (this._componentLoaded("assist_pipeline")) {
      active.push(catalog.find((item) => item.id === "conversation"));
    }

    const cloud = this._cloudStatus;
    if (cloud?.logged_in) {
      if (cloud.prefs?.alexa_enabled) {
        active.push(catalog.find((item) => item.id === "cloud.alexa"));
      }
      if (cloud.prefs?.google_enabled) {
        active.push(catalog.find((item) => item.id === "cloud.google_assistant"));
      }
    }

    return active.filter(Boolean);
  }

  _assistantById(assistantId) {
    return (
      this._activeAssistants.find((item) => item.id === assistantId) ||
      this._assistantCatalog().find((item) => item.id === assistantId) ||
      {
        id: assistantId,
        label: assistantId,
        shortLabel: assistantId,
        icon: "mdi:account-voice",
      }
    );
  }

  _assistantIds() {
    return this._activeAssistants.map((assistant) => assistant.id);
  }

  _assistantExposedCount(assistantId) {
    return this._entities.filter(
      (entity) => this._exposureState(entity.entityId, assistantId) === "exposed"
    ).length;
  }

  async _loadAssistantSupport() {
    this._assistantSupport = new Map();
    this._assistantSupportLoading = true;

    const jobs = [];

    if (this._activeAssistants.some((assistant) => assistant.id === "cloud.alexa")) {
      jobs.push(
        this._callWS({ type: "cloud/alexa/entities" })
          .then((entities) => {
            this._assistantSupport.set("cloud.alexa", {
              known: true,
              entities: new Set(
                (Array.isArray(entities) ? entities : [])
                  .map((entry) => entry?.entity_id)
                  .filter(Boolean)
              ),
            });
          })
          .catch((err) => {
            console.warn(
              "Assist Entity Manager: Alexa support information could not be loaded",
              err
            );
            this._assistantSupport.set("cloud.alexa", {
              known: false,
              entities: new Set(),
            });
          })
      );
    }

    if (
      this._activeAssistants.some(
        (assistant) => assistant.id === "cloud.google_assistant"
      )
    ) {
      jobs.push(
        this._callWS({ type: "cloud/google_assistant/entities" })
          .then((entities) => {
            this._assistantSupport.set("cloud.google_assistant", {
              known: true,
              entities: new Set(
                (Array.isArray(entities) ? entities : [])
                  .map((entry) => entry?.entity_id)
                  .filter(Boolean)
              ),
            });
          })
          .catch((err) => {
            console.warn(
              "Assist Entity Manager: Google support information could not be loaded",
              err
            );
            this._assistantSupport.set("cloud.google_assistant", {
              known: false,
              entities: new Set(),
            });
          })
      );
    }

    // Home Assistant currently has no matching per-entity support list for Assist.
    this._assistantSupport.set("conversation", {
      known: false,
      entities: new Set(),
    });

    await Promise.all(jobs);
    this._assistantSupportLoading = false;
  }

  _assistantSupportState(assistantId, entityId) {
    if (assistantId === "conversation") return "unknown";

    const support = this._assistantSupport.get(assistantId);
    if (!support?.known) return "unknown";

    return support.entities.has(entityId) ? "supported" : "unsupported";
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  static getStubConfig() {
    return {};
  }

  getCardSize() {
    return 12;
  }

  getGridOptions() {
    return {
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 4,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;

    // PERFORMANCE: Home Assistant calls this setter whenever its global state
    // object changes. Re-rendering hundreds of rows here caused the whole
    // dashboard to lag. Entity/registry/exposure data is static for this
    // management view, so we load it once and refresh only on explicit user
    // actions or via the refresh button.
    if (first && !this._loaded && !this._loading) {
      this._load();
    }
  }

  get hass() {
    return this._hass;
  }

  async _callWS(message) {
    if (!this._hass) throw new Error("Home Assistant is not available yet.");

    // Home Assistant's frontend helper returns the command result directly.
    if (typeof this._hass.callWS === "function") {
      return await this._hass.callWS(message);
    }

    // Fallback for older/custom frontend contexts.
    const response = await this._hass.connection.sendMessagePromise(message);
    return response?.result ?? response;
  }

  async _load() {
    if (!this._hass || this._loading) return;

    this._loading = true;
    this._error = "";
    this._render();

    try {
      const cloudStatusPromise = this._componentLoaded("cloud")
        ? this._callWS({ type: "cloud/status" }).catch((err) => {
            console.warn("Assist Entity Manager: Cloud status unavailable", err);
            return null;
          })
        : Promise.resolve(null);

      const [registryResult, exposedResult, areaResult, deviceResult, cloudStatus] =
        await Promise.all([
          this._callWS({ type: "config/entity_registry/list_for_display" }),
          this._callWS({ type: "homeassistant/expose_entity/list" }),
          this._callWS({ type: "config/area_registry/list" }),
          this._callWS({ type: "config/device_registry/list" }),
          cloudStatusPromise,
        ]);

      this._cloudStatus = cloudStatus;
      this._activeAssistants = this._deriveActiveAssistants();
      await this._loadAssistantSupport();

      if (!this._activeAssistants.some((item) => item.id === this._bulkAssistant)) {
        this._bulkAssistant = this._activeAssistants[0]?.id || "";
      }

      this._areas = new Map(
        (areaResult || []).map((area) => [area.area_id, area])
      );

      this._devices = new Map(
        (deviceResult || []).map((device) => [device.id, device])
      );

      this._exposed = exposedResult?.exposed_entities || {};

      const categoryMap = registryResult?.entity_categories || {};
      const registryEntities = registryResult?.entities || [];
      const regMap = new Map(registryEntities.map((entry) => [entry.ei, entry]));

      // Start with all active states so helpers/scripts/scenes are not lost.
      const ids = new Set([
        ...Object.keys(this._hass.states || {}),
        ...registryEntities.map((entry) => entry.ei),
      ]);

      this._entities = [...ids].map((entityId) => {
        const reg = regMap.get(entityId) || {};
        const state = this._hass.states?.[entityId];
        const device = reg.di ? this._devices.get(reg.di) : undefined;
        const areaId = reg.ai || device?.area_id || "";
        const area = areaId ? this._areas.get(areaId) : undefined;
        const domain = entityId.split(".")[0];
        const category =
          reg.ec !== undefined && reg.ec !== null
            ? categoryMap[reg.ec] || ""
            : "";

        const friendlyName =
          state?.attributes?.friendly_name ||
          reg.en ||
          this._humanizeEntityId(entityId);

        return {
          entityId,
          domain,
          name: friendlyName,
          registryName: reg.en || "",
          areaId,
          areaName: area?.name || "",
          deviceId: reg.di || "",
          deviceName: this._deviceName(device),
          platform: reg.pl || "",
          category,
          hidden: Boolean(reg.hb),
          icon: reg.ic || state?.attributes?.icon || "",
          labels: Array.isArray(reg.lb) ? reg.lb : [],
          translationKey: reg.tk || "",
          aliases: [],
          useEntityNameAlias: false,
          deviceClass: state?.attributes?.device_class || "",
          state: state?.state ?? "",
        };
      });

      this._sortEntities();
      this._processExternalChanges();
      this._applyPendingViewState();

      if (
        this._qualityfilter === "external_changes" &&
        !this._externalChanges.length
      ) {
        this._qualityfilter = "";
      }

      this._loaded = true;
    } catch (err) {
      console.error("Assist Entity Manager:", err);
      this._error = err?.message || String(err);
    } finally {
      this._loading = false;
      this._render();

      if (this._loaded && !this._aliasIndexReady && !this._aliasIndexLoading) {
        this._scheduleAliasIndexLoad();
      }
    }
  }

  _scheduleAliasIndexLoad() {
    const run = () => this._loadAliasIndex();

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1800 });
    } else {
      window.setTimeout(run, 250);
    }
  }

  async _loadAliasIndex() {
    if (!this._loaded || this._aliasIndexLoading || this._aliasIndexReady) return;

    this._aliasIndexLoading = true;
    this._aliasIndexError = "";

    try {
      const ids = this._entities.map((entity) => entity.entityId);
      const chunkSize = 80;

      for (let start = 0; start < ids.length; start += chunkSize) {
        const chunk = ids.slice(start, start + chunkSize);
        const result = await this._callWS({
          type: "config/entity_registry/get_entries",
          entity_ids: chunk,
        });

        for (const entityId of chunk) {
          const registry = result?.[entityId];
          if (!registry) continue;

          const entity = this._entities.find((item) => item.entityId === entityId);
          if (!entity) continue;

          const registryAliases = Array.isArray(registry.aliases)
            ? registry.aliases
            : [];

          entity.useEntityNameAlias = registryAliases.includes(null);
          entity.aliases = registryAliases.filter(
            (alias) => typeof alias === "string" && alias.trim()
          );

          if (registry.device_class && !entity.deviceClass) {
            entity.deviceClass = registry.device_class;
          }
        }

        // Yield between chunks so Home Assistant's UI remains responsive.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }

      this._aliasIndexReady = true;
      this._rebuildSpokenNameIndex();
    } catch (err) {
      console.warn("Assist Entity Manager: Alias index could not be loaded completely", err);
      this._aliasIndexError = err?.message || String(err);
    } finally {
      this._aliasIndexLoading = false;
      this._render();
    }
  }

  _refreshFriendlyNames() {
    for (const entity of this._entities) {
      const state = this._hass?.states?.[entity.entityId];
      if (state?.attributes?.friendly_name) {
        entity.name = state.attributes.friendly_name;
      }
      if (state) entity.state = state.state;
    }
  }

  _sortEntities() {
    const collator = new Intl.Collator(this._hass?.language || "de", {
      sensitivity: "base",
      numeric: true,
    });

    this._entities.sort((a, b) => {
      const areaA = a.areaName || "~~~~";
      const areaB = b.areaName || "~~~~";
      const byArea = collator.compare(areaA, areaB);
      if (byArea) return byArea;
      const byName = collator.compare(a.name || "", b.name || "");
      if (byName) return byName;
      return collator.compare(a.entityId, b.entityId);
    });
  }

  _deviceName(device) {
    if (!device) return "";
    return (
      device.name_by_user ||
      device.name ||
      device.model ||
      device.manufacturer ||
      ""
    );
  }

  _deviceAssignmentName(device) {
    if (!device) return "";
    return (
      device.name ||
      device.name_by_user ||
      device.model ||
      device.manufacturer ||
      ""
    );
  }

  _deviceAssignmentOptions(areaId) {
    return [...this._devices.values()]
      .filter((device) => !areaId || device.area_id === areaId)
      .sort((a, b) =>
        this._deviceAssignmentName(a).localeCompare(
          this._deviceAssignmentName(b),
          this._hass?.language || "en",
          { sensitivity: "base" }
        )
      )
      .map((device) => ({
        value: device.id,
        label: this._deviceAssignmentName(device) || device.id,
      }));
  }

  _domainIcon(domain) {
    const icons = {
      light: "mdi:lightbulb-outline",
      switch: "mdi:toggle-switch-outline",
      sensor: "mdi:gauge",
      binary_sensor: "mdi:checkbox-marked-circle-outline",
      climate: "mdi:thermostat",
      cover: "mdi:window-shutter",
      lock: "mdi:lock-outline",
      fan: "mdi:fan",
      media_player: "mdi:play-circle-outline",
      vacuum: "mdi:robot-vacuum",
      camera: "mdi:cctv",
      scene: "mdi:palette-outline",
      script: "mdi:script-text-outline",
      automation: "mdi:robot-outline",
      button: "mdi:gesture-tap-button",
      input_boolean: "mdi:toggle-switch",
      input_number: "mdi:numeric",
      person: "mdi:account-outline",
      weather: "mdi:weather-partly-cloudy",
      alarm_control_panel: "mdi:shield-home-outline",
    };
    return icons[domain] || "mdi:home-assistant";
  }

  _translateDeviceClass(domain, deviceClass) {
    if (!deviceClass) return "";

    const key = `${domain}:${deviceClass}`;
    const exact = {
      "switch:outlet": "Outlet",
      "switch:switch": "Switch",
      "cover:awning": "Awning",
      "cover:blind": "Blind",
      "cover:curtain": "Curtain",
      "cover:damper": "Damper",
      "cover:door": "Door",
      "cover:garage": "Garage door",
      "cover:gate": "Gate",
      "cover:shade": "Shade",
      "cover:shutter": "Shutter",
      "cover:window": "Window",
      "binary_sensor:battery": "Battery status",
      "binary_sensor:battery_charging": "Battery charging",
      "binary_sensor:carbon_monoxide": "Carbon monoxide",
      "binary_sensor:cold": "Cold",
      "binary_sensor:connectivity": "Connectivity",
      "binary_sensor:door": "Door contact",
      "binary_sensor:garage_door": "Garage door contact",
      "binary_sensor:gas": "Gas",
      "binary_sensor:heat": "Heat",
      "binary_sensor:light": "Light",
      "binary_sensor:lock": "Lock status",
      "binary_sensor:moisture": "Moisture / water",
      "binary_sensor:motion": "Motion",
      "binary_sensor:moving": "Moving",
      "binary_sensor:occupancy": "Occupancy",
      "binary_sensor:opening": "Opening",
      "binary_sensor:plug": "Plug",
      "binary_sensor:power": "Power",
      "binary_sensor:presence": "Presence",
      "binary_sensor:problem": "Problem",
      "binary_sensor:running": "Running",
      "binary_sensor:safety": "Safety",
      "binary_sensor:smoke": "Smoke",
      "binary_sensor:sound": "Sound",
      "binary_sensor:tamper": "Tamper",
      "binary_sensor:update": "Update available",
      "binary_sensor:vibration": "Vibration",
      "binary_sensor:window": "Window contact",
      "sensor:apparent_power": "Apparent power",
      "sensor:aqi": "Air quality index",
      "sensor:atmospheric_pressure": "Atmospheric pressure",
      "sensor:battery": "Battery",
      "sensor:carbon_dioxide": "CO₂",
      "sensor:carbon_monoxide": "Carbon monoxide",
      "sensor:current": "Current",
      "sensor:data_rate": "Data rate",
      "sensor:data_size": "Data size",
      "sensor:distance": "Distance",
      "sensor:duration": "Duration",
      "sensor:energy": "Energy",
      "sensor:energy_distance": "Energy per distance",
      "sensor:frequency": "Frequency",
      "sensor:gas": "Gas volume",
      "sensor:humidity": "Humidity",
      "sensor:illuminance": "Illuminance",
      "sensor:irradiance": "Irradiance",
      "sensor:monetary": "Monetary",
      "sensor:moisture": "Moisture",
      "sensor:nitrogen_dioxide": "Nitrogen dioxide",
      "sensor:nitrogen_monoxide": "Nitrogen monoxide",
      "sensor:nitrous_oxide": "Nitrous oxide",
      "sensor:ozone": "Ozone",
      "sensor:ph": "pH",
      "sensor:pm1": "PM1",
      "sensor:pm10": "PM10",
      "sensor:pm25": "PM2.5",
      "sensor:power": "Power",
      "sensor:power_factor": "Power factor",
      "sensor:precipitation": "Precipitation",
      "sensor:precipitation_intensity": "Precipitation intensity",
      "sensor:pressure": "Pressure",
      "sensor:reactive_power": "Reactive power",
      "sensor:signal_strength": "Signal strength",
      "sensor:sound_pressure": "Sound pressure",
      "sensor:speed": "Speed",
      "sensor:sulphur_dioxide": "Sulphur dioxide",
      "sensor:temperature": "Temperature",
      "sensor:timestamp": "Timestamp",
      "sensor:volatile_organic_compounds": "Volatile organic compounds",
      "sensor:volatile_organic_compounds_parts": "VOC parts",
      "sensor:voltage": "Voltage",
      "sensor:volume": "Volume",
      "sensor:volume_flow_rate": "Volume flow rate",
      "sensor:volume_storage": "Storage volume",
      "sensor:water": "Water",
      "sensor:weight": "Weight",
      "sensor:wind_direction": "Wind direction",
      "sensor:wind_speed": "Wind speed",
      "button:identify": "Identify",
      "button:restart": "Restart",
      "button:update": "Update",
      "number:apparent_power": "Apparent power",
      "number:current": "Current",
      "number:distance": "Distance",
      "number:energy": "Energy",
      "number:frequency": "Frequency",
      "number:humidity": "Humidity",
      "number:illuminance": "Illuminance",
      "number:power": "Power",
      "number:pressure": "Pressure",
      "number:reactive_power": "Reactive power",
      "number:signal_strength": "Signal strength",
      "number:temperature": "Temperature",
      "number:voltage": "Voltage",
      "number:volume": "Volume",
      "number:weight": "Weight",
    };

    if (exact[key]) return exact[key];

    const generic = {
      battery: "Battery",
      current: "Current",
      door: "Door",
      energy: "Energy",
      frequency: "Frequency",
      gas: "Gas",
      humidity: "Humidity",
      light: "Light",
      lock: "Schloss",
      moisture: "Moisture",
      motion: "Motion",
      opening: "Opening",
      outlet: "Outlet",
      plug: "Plug",
      power: "Power",
      pressure: "Pressure",
      signal_strength: "Signal strength",
      smoke: "Smoke",
      speed: "Speed",
      switch: "Switch",
      temperature: "Temperature",
      timestamp: "Timestamp",
      voltage: "Voltage",
      water: "Wasser",
      weight: "Weight",
      window: "Window",
    };

    if (generic[deviceClass]) return generic[deviceClass];

    return String(deviceClass)
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  _deviceClassDisplay(entity, registry = null, state = null) {
    const raw = this._safeDeviceClass(
      entity,
      registry || {},
      state || this._currentState(entity.entityId)
    );
    if (!raw) return { raw: "", label: "" };
    return {
      raw,
      label: this._translateDeviceClass(entity.domain, raw),
    };
  }

  _groupKey(entity) {
    return entity.deviceId ? `device:${entity.deviceId}` : `entity:${entity.entityId}`;
  }

  _deviceGroups(entities) {
    const groups = [];
    const byKey = new Map();

    for (const entity of entities) {
      const key = this._groupKey(entity);
      let group = byKey.get(key);

      if (!group) {
        const device = this._currentDevice(entity);
        group = {
          key,
          deviceId: entity.deviceId || "",
          device,
          name: entity.deviceId
            ? entity.deviceName || "Unnamed device"
            : entity.name,
          areaName: entity.areaName || "No area",
          entities: [],
          platforms: new Set(),
        };
        byKey.set(key, group);
        groups.push(group);
      }

      group.entities.push(entity);
      if (entity.platform) group.platforms.add(entity.platform);
    }

    return groups;
  }

  _groupPageInfo(groups) {
    const totalPages = Math.max(1, Math.ceil(groups.length / this._groupPageSize));
    if (this._page > totalPages) this._page = totalPages;
    if (this._page < 1) this._page = 1;

    const start = (this._page - 1) * this._groupPageSize;
    const end = Math.min(start + this._groupPageSize, groups.length);

    return {
      totalPages,
      start,
      end,
      groups: groups.slice(start, end),
    };
  }

  _normalizeSpokenName(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase(this._hass?.language || "de");
  }

  _spokenNamesForEntity(entity) {
    const names = [];

    if (entity?.useEntityNameAlias && entity?.name) {
      names.push({
        value: entity.name,
        source: "Default name",
      });
    }

    for (const alias of entity?.aliases || []) {
      if (typeof alias !== "string" || !alias.trim()) continue;
      names.push({
        value: alias.trim(),
        source: "Alias",
      });
    }

    return names;
  }

  _rebuildSpokenNameIndex() {
    const index = new Map();
    const displayNames = new Map();

    const add = (spokenName, entityId, source) => {
      const normalized = this._normalizeSpokenName(spokenName);
      if (!normalized) return;

      if (!displayNames.has(normalized)) {
        displayNames.set(normalized, String(spokenName || "").trim());
      }

      if (!index.has(normalized)) index.set(normalized, new Map());
      const entries = index.get(normalized);

      if (!entries.has(entityId)) {
        entries.set(entityId, {
          entityId,
          sources: new Set(),
        });
      }
      entries.get(entityId).sources.add(source);
    };

    for (const entity of this._entities) {
      for (const spokenName of this._spokenNamesForEntity(entity)) {
        add(spokenName.value, entity.entityId, spokenName.source);
      }
    }

    this._spokenNameIndex = index;

    const groups = [];
    const conflictEntityIds = new Set();
    const conflictsByEntity = new Map();

    for (const [normalized, entries] of index.entries()) {
      const consideredEntries = [...entries.values()].filter(
        (entry) => !this._isConflictIgnored(entry.entityId)
      );

      if (consideredEntries.length < 2) continue;

      const conflictingAssistantIds = this._assistantIds().filter(
        (assistantId) => {
          const exposedEntities = consideredEntries.filter(
            (entry) =>
              this._exposureState(entry.entityId, assistantId) === "exposed"
          );
          return exposedEntities.length >= 2;
        }
      );

      // A red "real conflict" only exists when at least two equal spoken names
      // are exposed to the same currently active assistant.
      if (!conflictingAssistantIds.length) continue;

      const relevantEntries = consideredEntries.filter((entry) =>
        conflictingAssistantIds.some(
          (assistantId) =>
            this._exposureState(entry.entityId, assistantId) === "exposed"
        )
      );

      const entities = relevantEntries.map((entry) => {
        const entity = this._entities.find(
          (item) => item.entityId === entry.entityId
        );

        conflictEntityIds.add(entry.entityId);

        if (!conflictsByEntity.has(entry.entityId)) {
          conflictsByEntity.set(entry.entityId, []);
        }
        conflictsByEntity.get(entry.entityId).push(
          displayNames.get(normalized) || normalized
        );

        return {
          entityId: entry.entityId,
          name: entity?.name || entry.entityId,
          areaName: entity?.areaName || "",
          deviceName: entity?.deviceName || "",
          sources: [...entry.sources],
        };
      });

      groups.push({
        normalized,
        spokenName: displayNames.get(normalized) || normalized,
        entities,
        assistants: conflictingAssistantIds.map((assistantId) =>
          this._assistantById(assistantId)
        ),
      });
    }

    groups.sort((a, b) =>
      a.spokenName.localeCompare(
        b.spokenName,
        this._hass?.language || "de",
        { sensitivity: "base", numeric: true }
      )
    );

    this._conflictGroupsCache = groups;
    this._conflictEntityIds = conflictEntityIds;
    this._conflictsByEntity = conflictsByEntity;

    if (!groups.length && this._specialView === "conflicts") {
      this._specialView = "";
    }
  }

  _exactConflictGroups() {
    return this._aliasIndexReady ? this._conflictGroupsCache : [];
  }

  _entityHasExactConflict(entityId) {
    return this._aliasIndexReady && this._conflictEntityIds.has(entityId);
  }

  _entityConflictNames(entityId) {
    return this._aliasIndexReady
      ? this._conflictsByEntity.get(entityId) || []
      : [];
  }

  _ambiguousNameIssues(entity) {
    if (!this._preferences.detectAmbiguousNames) return [];

    const generic = new Set([
      "licht",
      "lampe",
      "schalter",
      "steckdose",
      "sensor",
      "temperatur",
      "luftfeuchtigkeit",
      "feuchtigkeit",
      "bewegung",
      "fenster",
      "tür",
      "rollload",
      "jalousie",
      "heizung",
      "thermostat",
      "klima",
      "kamera",
      "ventilator",
      "lüfter",
      "strom",
      "energie",
      "leistung",
      "batterie",
      "alarm",
      "status",
      "taste",
      "button",
      "tor",
      "garagentor",
      "vorhang",
      "markise",
    ]);

    const candidates = this._spokenNamesForEntity(entity);

    const seen = new Set();
    const issues = [];

    for (const candidate of candidates) {
      const value = String(candidate.value || "").trim();
      const normalized = this._normalizeSpokenName(value);
      if (!normalized || seen.has(`${candidate.source}:${normalized}`)) continue;
      seen.add(`${candidate.source}:${normalized}`);

      const deviceClassLabel = this._deviceClassDisplay(entity).label;
      const matchesDeviceClass =
        deviceClassLabel &&
        normalized === this._normalizeSpokenName(deviceClassLabel);

      if (generic.has(normalized) || matchesDeviceClass) {
        const areaHint =
          entity.areaName &&
          !normalized.includes(this._normalizeSpokenName(entity.areaName))
            ? ` The area “${entity.areaName}” is not included in the spoken name.`
            : "";

        issues.push({
          value,
          source: candidate.source,
          reason: `${candidate.source} „${value}“ is very generic and may be ambiguous for voice control.${areaHint}`,
        });
      }
    }

    return issues;
  }

  _ambiguousEntities() {
    if (!this._preferences.detectAmbiguousNames) return [];

    return this._entities
      .map((entity) => ({
        entity,
        issues: this._ambiguousNameIssues(entity),
      }))
      .filter((item) => item.issues.length);
  }

  _unnecessaryInfo(entity) {
    if (!this._preferences.detectUnnecessary) return null;

    const domain = entity.domain;
    const category = entity.category || "";
    const deviceClass = this._deviceClassDisplay(entity).raw || "";
    const haystack = [
      entity.entityId,
      entity.name,
      entity.registryName,
      deviceClass,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase(this._hass?.language || "de");

    if (category === "diagnostic") {
      return {
        reason: "Home Assistant marks this entity as a diagnostic entity.",
        code: "diagnostic",
      };
    }

    if (category === "config") {
      return {
        reason: "Home Assistant marks this entity as a configuration entity.",
        code: "config",
      };
    }

    if (domain === "update") {
      return {
        reason: "Update entities are usually not needed for normal voice control.",
        code: "update",
      };
    }

    if (deviceClass === "signal_strength") {
      return {
        reason: "Signal strength is usually technical diagnostic information.",
        code: "signal",
      };
    }

    if (
      domain === "button" &&
      ["identify", "restart", "update"].includes(deviceClass)
    ) {
      return {
        reason: "This button is related to device maintenance and is usually not needed for voice control.",
        code: "maintenance",
      };
    }

    const technicalPatterns = [
      /\brssi\b/i,
      /\blqi\b/i,
      /\blink.?quality\b/i,
      /\blast.?seen\b/i,
      /\buptime\b/i,
      /\bfirmware\b/i,
      /\bsw.?version\b/i,
      /\bhw.?version\b/i,
      /\bdiagnostic\b/i,
    ];

    if (technicalPatterns.some((pattern) => pattern.test(haystack))) {
      return {
        reason: "Der Name deutet auf eine technische Diagnostic- oder Wartungsinformation hin.",
        code: "technical",
      };
    }

    return null;
  }

  _unnecessaryEntities() {
    if (!this._preferences.detectUnnecessary) return [];
    return this._entities
      .map((entity) => ({
        entity,
        info: this._unnecessaryInfo(entity),
      }))
      .filter((item) => item.info);
  }


  _spokenNameConflicts(value, ownEntityId) {
    if (!this._aliasIndexReady) return [];
    if (this._isConflictIgnored(ownEntityId)) return [];

    const normalized = this._normalizeSpokenName(value);
    if (!normalized) return [];

    const entries = this._spokenNameIndex.get(normalized);
    if (!entries) return [];

    return [...entries.values()]
      .filter(
        (entry) =>
          entry.entityId !== ownEntityId &&
          !this._isConflictIgnored(entry.entityId)
      )
      .map((entry) => {
        const entity = this._entities.find((item) => item.entityId === entry.entityId);
        return {
          entityId: entry.entityId,
          name: entity?.name || entry.entityId,
          areaName: entity?.areaName || "",
          sources: [...entry.sources],
        };
      });
  }

  _entityAliasConflicts(entityId, aliases) {
    const result = [];
    for (const alias of aliases || []) {
      const conflicts = this._spokenNameConflicts(alias, entityId);
      if (conflicts.length) {
        result.push({ alias, conflicts });
      }
    }
    return result;
  }

  _openEntityInHA(entityId) {
    this._saveViewState();

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("more-info-entity-id", entityId);
      window.location.assign(url.toString());
    } catch (_err) {
      window.location.assign(
        `${window.location.pathname}?more-info-entity-id=${encodeURIComponent(entityId)}`
      );
    }
  }

  _openDeviceInHA(deviceId) {
    if (!deviceId) return;

    this._saveViewState();
    window.location.assign(`/config/devices/device/${encodeURIComponent(deviceId)}`);
  }

  _humanizeEntityId(entityId) {
    const objectId = entityId.split(".").slice(1).join(".");
    return objectId
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  _currentState(entityId) {
    return this._hass?.states?.[entityId] || null;
  }

  _currentDevice(entity) {
    return entity?.deviceId ? this._devices.get(entity.deviceId) : null;
  }

  _formatDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat(this._hass?.language || "de-DE", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(value));
    } catch (_err) {
      return String(value);
    }
  }

  _formatValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (_err) {
        return String(value);
      }
    }
    return String(value);
  }

  _safeDeviceClass(entity, registry, state) {
    return (
      registry?.device_class ||
      entity?.deviceClass ||
      state?.attributes?.device_class ||
      ""
    );
  }

  _pageInfo(filtered) {
    const totalPages = Math.max(1, Math.ceil(filtered.length / this._pageSize));
    if (this._page > totalPages) this._page = totalPages;
    if (this._page < 1) this._page = 1;
    const start = (this._page - 1) * this._pageSize;
    const end = Math.min(start + this._pageSize, filtered.length);
    return {
      totalPages,
      start,
      end,
      rows: filtered.slice(start, end),
    };
  }

  async _openDetails(entityId) {
    const entity = this._entities.find((item) => item.entityId === entityId);
    if (!entity) return;

    this._detailEntityId = entityId;
    this._detailRegistry = null;
    this._detailError = "";
    this._aliasError = "";
    this._aliasSuccess = "";
    this._assignmentError = "";
    this._assignmentSuccess = "";
    this._detailLoading = true;
    this._render();

    try {
      this._detailRegistry = await this._callWS({
        type: "config/entity_registry/get",
        entity_id: entityId,
      });

      const rawAliases = Array.isArray(this._detailRegistry?.aliases)
        ? this._detailRegistry.aliases
        : [];
      entity.useEntityNameAlias = rawAliases.includes(null);
      entity.aliases = rawAliases.filter(
        (alias) => typeof alias === "string" && alias.trim()
      );

      if (this._aliasIndexReady) {
        this._rebuildSpokenNameIndex();
      }
    } catch (err) {
      // Entities without a registry entry can still be shown using state data.
      this._detailError = err?.message || String(err);
    } finally {
      this._detailLoading = false;
      this._render();
    }
  }

  _closeDetails() {
    this._detailEntityId = null;
    this._detailRegistry = null;
    this._detailLoading = false;
    this._detailError = "";
    this._aliasError = "";
    this._aliasSuccess = "";
    this._assignmentError = "";
    this._assignmentSuccess = "";
    this._render();
  }

  _renderDetails() {
    if (!this._detailEntityId) return "";

    const entity = this._entities.find(
      (item) => item.entityId === this._detailEntityId
    );
    if (!entity) return "";

    const state = this._currentState(entity.entityId);
    const device = this._currentDevice(entity);
    const reg = this._detailRegistry || {};
    const deviceClassInfo = this._deviceClassDisplay(entity, reg, state);
    const deviceClass = deviceClassInfo.raw;
    const unit = state?.attributes?.unit_of_measurement || "";
    const icon = reg.icon || entity.icon || this._domainIcon(entity.domain);
    const rawAliases = Array.isArray(reg.aliases)
      ? reg.aliases
      : [
          ...(entity.useEntityNameAlias ? [null] : []),
          ...(Array.isArray(entity.aliases) ? entity.aliases : []),
        ];
    const useEntityNameAlias = rawAliases.includes(null);
    const aliases = rawAliases.filter(
      (alias) => typeof alias === "string" && alias.trim()
    );
    const originalName = reg.original_name || "";
    const registryName = reg.name || entity.registryName || "";
    const manufacturer = device?.manufacturer || "";
    const model = device?.model || "";
    const modelId = device?.model_id || "";
    const serial = device?.serial_number || "";
    const swVersion = device?.sw_version || "";
    const hwVersion = device?.hw_version || "";
    const activeAssistants = this._activeAssistants;
    const aliasConflicts = this._entityAliasConflicts(entity.entityId, aliases);

    const commonAttributeKeys = new Set([
      "friendly_name",
      "icon",
      "device_class",
      "unit_of_measurement",
      "supported_features",
    ]);

    const extraAttributes = Object.entries(state?.attributes || {})
      .filter(([key]) => !commonAttributeKeys.has(key))
      .slice(0, 20);

    return `
      <div class="detail-backdrop" role="presentation">
        <section class="detail-panel" role="dialog" aria-modal="true" aria-label="Entity details">
          <div class="detail-header">
            <div class="detail-title-wrap">
              <div class="detail-icon">
                <ha-icon icon="${this._escapeAttr(icon)}"></ha-icon>
              </div>
              <div>
                <div class="detail-eyebrow">ENTITY DETAILS</div>
                <h2>${this._escape(entity.name)}</h2>
                <div class="detail-entity-id">${this._escape(entity.entityId)}</div>
              </div>
            </div>
            <button class="detail-close icon-btn" type="button" title="Close">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>

          ${
            this._detailLoading
              ? `<div class="detail-loading"><span class="spinner"></span>Loading full registry data …</div>`
              : ""
          }

          ${
            this._detailError
              ? `<div class="detail-note">No additional registry data could be loaded for this entity. State and device data are still shown.</div>`
              : ""
          }

          ${
            (() => {
              const unnecessary = this._unnecessaryInfo(entity);
              const ambiguous = this._ambiguousNameIssues(entity);
              const conflicts = this._entityConflictNames(entity.entityId);

              if (!unnecessary && !ambiguous.length && !conflicts.length) return "";

              return `
                <div class="detail-quality-warnings">
                  ${
                    conflicts.length
                      ? `<div class="detail-quality-item conflict">
                          <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
                          <div>
                            <strong>Name conflict</strong>
                            <span>Other entities also use: ${conflicts
                              .map((name) => `„${this._escape(name)}“`)
                              .join(", ")}</span>
                          </div>
                        </div>`
                      : ""
                  }
                  ${
                    ambiguous.length
                      ? `<div class="detail-quality-item warning">
                          <ha-icon icon="mdi:help-circle-outline"></ha-icon>
                          <div>
                            <strong>Potentially ambiguous name</strong>
                            <span>${this._escape(ambiguous[0].reason)}</span>
                          </div>
                        </div>`
                      : ""
                  }
                  ${
                    unnecessary
                      ? `<div class="detail-quality-item muted">
                          <ha-icon icon="mdi:broom"></ha-icon>
                          <div>
                            <strong>Probably not needed for voice control</strong>
                            <span>${this._escape(unnecessary.reason)}</span>
                          </div>
                        </div>`
                      : ""
                  }
                </div>
              `;
            })()
          }

          <div class="detail-assistants">
            <div class="detail-section-title">
              <div>
                <h3>Voice assistants</h3>
                <p>Only assistants enabled in Home Assistant are shown.</p>
              </div>
            </div>

            ${
              activeAssistants.length
                ? `
                  <div class="detail-assistant-list">
                    ${activeAssistants
                      .map((assistant) => {
                        const isOn =
                          this._exposureState(entity.entityId, assistant.id) ===
                          "exposed";
                        const supportState = this._assistantSupportState(
                          assistant.id,
                          entity.entityId
                        );
                        const unsupported = supportState === "unsupported";

                        return `
                          <div class="detail-assistant-row ${isOn ? "on" : ""} ${
                            unsupported ? "unsupported" : ""
                          }">
                            <div class="assistant-brand">
                              <span class="assistant-brand-icon">
                                ${this._assistantIconMarkup(assistant)}
                              </span>
                              <div>
                                <strong>${this._escape(assistant.label)}</strong>
                                ${
                                  unsupported
                                    ? `<small class="assistant-unsupported-text">
                                        <ha-icon icon="mdi:alert-circle"></ha-icon>
                                        Not supported${
                                          isOn ? " – disabling is still possible" : ""
                                        }
                                      </small>`
                                    : `<small>${
                                        isOn
                                          ? "This entity is exposed"
                                          : "This entity is not exposed"
                                      }</small>`
                                }
                              </div>
                            </div>

                            <label class="switch detail-switch" title="${this._escapeAttr(
                              assistant.label
                            )}-exposure change">
                              <input
                                class="detail-assistant-toggle"
                                type="checkbox"
                                data-assistant="${this._escapeAttr(assistant.id)}"
                                ${isOn ? "checked" : ""}
                                ${unsupported && !isOn ? "disabled" : ""}
                              >
                              <span class="slider"></span>
                            </label>
                          </div>
                        `;
                      })
                      .join("")}
                  </div>
                `
                : `<div class="detail-note inline-note">No supported voice assistant is currently enabled in Home Assistant settings.</div>`
            }
          </div>

          <div class="alias-editor">
            <div class="detail-section-title">
              <div>
                <h3>Spoken names & aliases</h3>
                <p>Choose whether the default name may be spoken and which additional names should be recognized.</p>
              </div>
            </div>

            <label class="entity-name-alias-row">
              <span class="entity-name-alias-icon">
                <ha-icon icon="${useEntityNameAlias ? "mdi:account-voice" : "mdi:account-voice-off"}"></ha-icon>
              </span>
              <span class="entity-name-alias-copy">
                <strong>${this._escape(entity.name)}</strong>
                <small>Default name. When enabled, it is used as the first alias.</small>
                <em class="${useEntityNameAlias ? "spoken-on" : "spoken-off"}">
                  ${useEntityNameAlias
                    ? "Used as a spoken name"
                    : "Default name is not used as a spoken name"}
                </em>
              </span>
              <span class="mini-switch setting-switch">
                <input
                  id="detail-entity-name-alias"
                  type="checkbox"
                  ${useEntityNameAlias ? "checked" : ""}
                  ${this._aliasSaving || this._detailLoading ? "disabled" : ""}
                >
                <span class="mini-slider"></span>
              </span>
            </label>

            ${
              aliases.length
                ? `
                  <div class="alias-chips">
                    ${aliases
                      .map(
                        (alias, index) => `
                          <span class="alias-chip ${
                            this._spokenNameConflicts(alias, entity.entityId).length
                              ? "has-conflict"
                              : ""
                          }">
                            ${
                              this._spokenNameConflicts(alias, entity.entityId).length
                                ? `<ha-icon class="alias-warning-icon" icon="mdi:alert-circle-outline"></ha-icon>`
                                : ""
                            }
                            <span>${this._escape(alias)}</span>
                            <button
                              class="remove-alias"
                              type="button"
                              data-alias-index="${index}"
                              title="Remove alias"
                            >
                              <ha-icon icon="mdi:close"></ha-icon>
                            </button>
                          </span>
                        `
                      )
                      .join("")}
                  </div>
                `
                : `<div class="alias-empty">No aliases added yet.</div>`
            }

            ${
              this._aliasIndexLoading
                ? `<div class="alias-index-note">
                    <span class="spinner small-spinner"></span>
                    Alias conflict check is loading in the background …
                  </div>`
                : ""
            }

            ${
              this._aliasIndexReady && aliasConflicts.length
                ? `
                  <div class="alias-conflict-box">
                    <div class="alias-conflict-title">
                      <ha-icon icon="mdi:alert-outline"></ha-icon>
                      <strong>${aliasConflicts.length === 1 ? "Possible name conflict" : "Possible name conflicts"}</strong>
                    </div>
                    ${aliasConflicts
                      .map(
                        (item) => `
                          <div class="alias-conflict-item">
                            <span class="alias-conflict-name">„${this._escape(item.alias)}“</span>
                            <span>also occurs on:</span>
                            <div class="alias-conflict-targets">
                              ${item.conflicts
                                .map(
                                  (conflict) => `
                                    <button
                                      class="conflict-entity-link"
                                      type="button"
                                      data-conflict-entity="${this._escapeAttr(conflict.entityId)}"
                                    >
                                      ${this._escape(conflict.name)}
                                      ${conflict.areaName ? ` · ${this._escape(conflict.areaName)}` : ""}
                                      <small>${this._escape(conflict.sources.join(" / "))}</small>
                                    </button>
                                  `
                                )
                                .join("")}
                            </div>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                `
                : ""
            }

            <div class="alias-add-row">
              <input
                id="alias-input"
                class="alias-input"
                type="text"
                maxlength="255"
                autocomplete="off"
                placeholder="z. B. Deckenlampe, Hauptlicht …"
                ${this._detailLoading || this._aliasSaving ? "disabled" : ""}
              >
              <button
                class="btn primary add-alias"
                type="button"
                ${this._detailLoading || this._aliasSaving ? "disabled" : ""}
              >
                <ha-icon icon="mdi:plus"></ha-icon>
                Add alias
              </button>
            </div>

            ${
              this._aliasError
                ? `<div class="alias-feedback error-text">${this._escape(
                    this._aliasError
                  )}</div>`
                : ""
            }
            ${
              this._aliasSuccess
                ? `<div class="alias-feedback success-text">${this._escape(
                    this._aliasSuccess
                  )}</div>`
                : ""
            }
          </div>

          <div class="detail-grid">
            <div class="detail-section">
              <h3>Entity</h3>
              ${this._detailItem("Domain", entity.domain)}
              ${this._detailItem(
                "Device class",
                deviceClass
                  ? `${deviceClassInfo.label} (${deviceClass})`
                  : ""
              )}
              ${this._detailItem("Current state", state?.state)}
              ${this._detailItem("Unit", unit)}
              ${this._detailItem("Integration / platform", entity.platform)}
              ${this._detailItem("Entity category", entity.category || "Normal")}
              ${this._detailItem("Registry name", registryName)}
              ${this._detailItem("Original name", originalName)}
            </div>

            <div class="detail-section">
              <h3>Assignment</h3>
              ${this._assignmentSelect(
                "Area",
                "detail-area-select",
                entity.areaId,
                "No area",
                [...this._areas.values()]
                  .sort((a, b) =>
                    (a.name || a.area_id || "").localeCompare(
                      b.name || b.area_id || "",
                      this._hass?.language || "en",
                      { sensitivity: "base" }
                    )
                  )
                  .map((area) => ({
                    value: area.area_id,
                    label: area.name || area.area_id,
                  }))
              )}
              ${this._assignmentSelect(
                "Device",
                "detail-device-select",
                entity.deviceId,
                "No device",
                this._deviceAssignmentOptions(entity.areaId)
              )}
              ${
                this._assignmentError
                  ? `<div class="assignment-feedback error-text">${this._escape(
                      this._assignmentError
                    )}</div>`
                  : ""
              }
              ${
                this._assignmentSuccess
                  ? `<div class="assignment-feedback success-text">${this._escape(
                      this._assignmentSuccess
                    )}</div>`
                  : ""
              }
              ${this._detailItem("Manufacturer", manufacturer)}
              ${this._detailItem("Model", model)}
              ${this._detailItem("Model ID", modelId)}
              ${this._detailItem("Serial number", serial)}
              ${this._detailItem("Software", swVersion)}
              ${this._detailItem("Hardware", hwVersion)}
            </div>

            <div class="detail-section">
              <h3>Status & technical details</h3>
              ${this._detailItem("Last changed", this._formatDate(state?.last_changed))}
              ${this._detailItem("Last updated", this._formatDate(state?.last_updated))}
              ${this._detailItem("Device ID", entity.deviceId)}
              ${this._detailItem("Area ID", entity.areaId)}
              ${this._detailItem("Icon", icon)}
              ${this._detailItem("Translation key", entity.translationKey)}
              ${this._detailItem("Hidden", entity.hidden ? "Yes" : "No")}
            </div>
          </div>

          ${
            extraAttributes.length
              ? `
                <details class="attributes">
                  <summary>Additional state attributes (${extraAttributes.length})</summary>
                  <div class="attribute-list">
                    ${extraAttributes
                      .map(
                        ([key, value]) => `
                          <div class="attribute-row">
                            <span>${this._escape(key)}</span>
                            <code>${this._escape(this._formatValue(value))}</code>
                          </div>`
                      )
                      .join("")}
                  </div>
                </details>
              `
              : ""
          }

          <div class="conflict-ignore-card ${this._isConflictIgnored(entity.entityId) ? "ignored" : ""}">
            <div class="conflict-ignore-icon">
              <ha-icon icon="${this._isConflictIgnored(entity.entityId) ? "mdi:bell-off-outline" : "mdi:bell-alert-outline"}"></ha-icon>
            </div>
            <div class="conflict-ignore-copy">
              <strong>Ignore conflict warnings for this entity</strong>
              <span>
                ${
                  this._isConflictIgnored(entity.entityId)
                    ? "This entity is excluded from the red conflict check."
                    : "Enable this if the name overlap for this entity is intentional."
                }
              </span>
              <small>This is only an Assist Entity Manager setting – Home Assistant itself is not changed.</small>
            </div>
            <span class="mini-switch setting-switch">
              <input
                id="detail-ignore-conflicts"
                type="checkbox"
                ${this._isConflictIgnored(entity.entityId) ? "checked" : ""}
              >
              <span class="mini-slider"></span>
            </span>
          </div>

          <div class="ha-links">
            <button
              class="btn secondary open-ha-entity"
              type="button"
              data-entity="${this._escapeAttr(entity.entityId)}"
            >
              <ha-icon icon="mdi:open-in-new"></ha-icon>
              Open entity in Home Assistant
            </button>

            ${
              entity.deviceId
                ? `
                  <button
                    class="btn secondary open-ha-device"
                    type="button"
                    data-device="${this._escapeAttr(entity.deviceId)}"
                  >
                    <ha-icon icon="mdi:devices"></ha-icon>
                    Open device in Home Assistant
                  </button>
                `
                : ""
            }
          </div>

          <div class="detail-footer">
            <span>Registry details are requested only when this view is opened.</span>
          </div>
        </section>
      </div>
    `;
  }

  async _saveAliases(nextAliases, useEntityNameAlias = null) {
    if (!this._detailEntityId || this._aliasSaving) return;

    const cleaned = [];
    const seen = new Set();

    for (const rawAlias of nextAliases || []) {
      const alias = String(rawAlias ?? "").trim();
      if (!alias) continue;
      const key = alias.toLocaleLowerCase(this._hass?.language || "de");
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(alias);
    }

    const entity = this._entities.find(
      (item) => item.entityId === this._detailEntityId
    );

    const currentRawAliases = Array.isArray(this._detailRegistry?.aliases)
      ? this._detailRegistry.aliases
      : [
          ...(entity?.useEntityNameAlias ? [null] : []),
          ...(entity?.aliases || []),
        ];

    const shouldUseEntityName =
      typeof useEntityNameAlias === "boolean"
        ? useEntityNameAlias
        : currentRawAliases.includes(null);

    const aliasesToSave = [
      ...(shouldUseEntityName ? [null] : []),
      ...cleaned,
    ];

    this._aliasSaving = true;
    this._aliasError = "";
    this._aliasSuccess = "";
    this._render();

    try {
      const result = await this._callWS({
        type: "config/entity_registry/update",
        entity_id: this._detailEntityId,
        aliases: aliasesToSave,
      });

      const savedRawAliases = Array.isArray(result?.aliases)
        ? result.aliases
        : aliasesToSave;
      const savedUseEntityName = savedRawAliases.includes(null);
      const savedAliases = savedRawAliases.filter(
        (alias) => typeof alias === "string" && alias.trim()
      );

      this._detailRegistry = {
        ...(this._detailRegistry || {}),
        ...(result || {}),
        aliases: savedRawAliases,
      };

      if (entity) {
        entity.aliases = [...savedAliases];
        entity.useEntityNameAlias = savedUseEntityName;
      }

      if (this._aliasIndexReady) {
        this._rebuildSpokenNameIndex();
      }

      this._aliasSuccess = "Aliases saved.";
    } catch (err) {
      console.error("Assist Entity Manager: Aliases save", err);
      this._aliasError =
        err?.message || "The aliases could not be saved.";
    } finally {
      this._aliasSaving = false;
      this._render();
    }
  }

  _toggleEntityNameAlias(enabled) {
    if (!this._detailEntityId || this._aliasSaving) return;

    const entity = this._entities.find(
      (item) => item.entityId === this._detailEntityId
    );
    const current = Array.isArray(this._detailRegistry?.aliases)
      ? this._detailRegistry.aliases.filter(
          (alias) => typeof alias === "string" && alias.trim()
        )
      : entity?.aliases || [];

    this._saveAliases(current, Boolean(enabled));
  }

  _addAliasFromInput() {
    const input = this.shadowRoot.querySelector("#alias-input");
    if (!input || this._detailLoading || this._aliasSaving) return;

    const value = input.value.trim();
    if (!value) return;

    const current = Array.isArray(this._detailRegistry?.aliases)
      ? this._detailRegistry.aliases.filter(
          (alias) => typeof alias === "string" && alias.trim()
        )
      : [];

    this._saveAliases([...current, value]);
  }

  _removeAliasAt(index) {
    const current = Array.isArray(this._detailRegistry?.aliases)
      ? this._detailRegistry.aliases.filter(
          (alias) => typeof alias === "string" && alias.trim()
        )
      : [];

    if (!Number.isInteger(index) || index < 0 || index >= current.length) return;
    this._saveAliases(current.filter((_alias, aliasIndex) => aliasIndex !== index));
  }

  _assignmentSelect(label, id, selectedValue, emptyLabel, options) {
    const saving = Boolean(this._assignmentSaving);
    return `
      <label class="detail-item detail-select-item" for="${this._escapeAttr(id)}">
        <span>${this._escape(label)}</span>
        <select
          id="${this._escapeAttr(id)}"
          ${this._detailLoading || saving ? "disabled" : ""}
        >
          <option value="" ${selectedValue ? "" : "selected"}>${this._escape(emptyLabel)}</option>
          ${(options || [])
            .map(
              (option) => `
                <option value="${this._escapeAttr(option.value)}" ${
                  selectedValue === option.value ? "selected" : ""
                }>${this._escape(option.label)}</option>
              `
            )
            .join("")}
        </select>
      </label>
    `;
  }

  async _saveEntityAssignment(field, value) {
    if (!this._detailEntityId || this._detailLoading || this._assignmentSaving) return;

    const entity = this._entities.find(
      (item) => item.entityId === this._detailEntityId
    );
    if (!entity) return;

    const fieldName = field === "device" ? "device_id" : "area_id";
    const currentValue = field === "device" ? entity.deviceId : entity.areaId;
    const nextValue = value || "";
    if (nextValue === (currentValue || "")) return;
    const nextDevice =
      field === "device" && nextValue ? this._devices.get(nextValue) : null;
    const assignmentChanges = {
      [fieldName]: nextValue || null,
      ...(nextDevice?.area_id ? { area_id: nextDevice.area_id } : {}),
    };

    this._assignmentSaving = field;
    this._assignmentError = "";
    this._assignmentSuccess = "";
    this._render();

    try {
      const result = await this._callWS({
        type: "assist_entity_manager/entity/update_assignment",
        entity_id: this._detailEntityId,
        ...assignmentChanges,
      });

      this._detailRegistry = {
        ...(this._detailRegistry || {}),
        ...(result || {}),
      };

      const savedDeviceId =
        this._detailRegistry?.device_id ??
        this._detailRegistry?.di ??
        (field === "device" ? nextValue : entity.deviceId) ??
        "";
      const explicitAreaId =
        this._detailRegistry?.area_id ??
        this._detailRegistry?.ai ??
        (field === "area" ? nextValue : "") ??
        "";
      const savedDevice = savedDeviceId ? this._devices.get(savedDeviceId) : undefined;
      const savedAreaId = explicitAreaId || savedDevice?.area_id || "";
      const savedArea = savedAreaId ? this._areas.get(savedAreaId) : undefined;

      entity.deviceId = savedDeviceId || "";
      entity.deviceName = this._deviceName(savedDevice);
      entity.areaId = savedAreaId || "";
      entity.areaName = savedArea?.name || "";

      this._sortEntities();
      this._assignmentSuccess =
        field === "device" ? "Device assignment saved." : "Area assignment saved.";
    } catch (err) {
      console.error("Assist Entity Manager: Assignment save", err);
      this._assignmentError =
        err?.message || "The assignment could not be saved.";
    } finally {
      this._assignmentSaving = "";
      this._render();
    }
  }

  _detailItem(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return `
      <div class="detail-item">
        <span>${this._escape(label)}</span>
        <strong>${this._escape(this._formatValue(value))}</strong>
      </div>
    `;
  }

  _exposureState(entityId, assistantId = "conversation") {
    const entry = this._exposed?.[entityId];

    if (
      !entry ||
      !Object.prototype.hasOwnProperty.call(entry, assistantId)
    ) {
      return "default";
    }

    return entry[assistantId] ? "exposed" : "blocked";
  }

  _isExposed(entityId, assistantId = null) {
    if (assistantId) {
      return this._exposureState(entityId, assistantId) === "exposed";
    }

    const activeIds = this._assistantIds();
    if (!activeIds.length) return false;

    return activeIds.some(
      (id) => this._exposureState(entityId, id) === "exposed"
    );
  }

  _isBlockedForAllActive(entityId) {
    const activeIds = this._assistantIds();
    if (!activeIds.length) return false;

    return activeIds.every(
      (id) => this._exposureState(entityId, id) === "blocked"
    );
  }

  _exposureSummary(entityId) {
    const activeIds = this._assistantIds();
    const exposed = activeIds.filter(
      (id) => this._exposureState(entityId, id) === "exposed"
    );

    if (exposed.length) return "exposed";
    if (this._isBlockedForAllActive(entityId)) return "blocked";
    return "default";
  }


  _matchesEntityfilters(entity, { ignoreExcludedPlatforms = false } = {}) {
    const search = this._filters.search.trim().toLowerCase();

    if (this._filters.area === "__none__" && entity.areaId) return false;
    if (
      this._filters.area &&
      this._filters.area !== "__none__" &&
      entity.areaId !== this._filters.area
    ) return false;

    if (this._filters.domain && entity.domain !== this._filters.domain) return false;

    if (this._filters.category) {
      if (this._filters.category === "normal" && entity.category) return false;
      if (
        this._filters.category !== "normal" &&
        entity.category !== this._filters.category
      ) {
        return false;
      }
    }

    const exposure = this._exposureSummary(entity.entityId);
    if (this._filters.status === "not_exposed" && exposure === "exposed") return false;
    if (
      this._filters.status &&
      this._filters.status !== "not_exposed" &&
      exposure !== this._filters.status
    ) return false;

    if (search) {
      const haystack = [
        entity.name,
        entity.registryName,
        entity.entityId,
        entity.areaName,
        entity.deviceName,
        entity.platform,
        entity.domain,
        ...(Array.isArray(entity.aliases) ? entity.aliases : []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) return false;
    }

    if (!ignoreExcludedPlatforms) {
      const platformKey = entity.platform || "__none__";
      if (this._excludedPlatforms.has(platformKey)) return false;
    }

    if (
      this._preferences.detectUnnecessary &&
      this._preferences.hideUnnecessary &&
      this._unnecessaryInfo(entity)
    ) {
      return false;
    }

    if (
      this._qualityfilter === "ambiguous" &&
      !this._ambiguousNameIssues(entity).length
    ) {
      return false;
    }

    if (
      this._qualityfilter === "external_changes" &&
      !this._externalChangeEntityIds().has(entity.entityId)
    ) {
      return false;
    }

    return true;
  }

  _filteredEntities() {
    return this._entities.filter((entity) => this._matchesEntityfilters(entity));
  }

  _integrationLabel(platform) {
    if (platform === "__none__") return "No integration";

    return String(platform || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  _integrationfilterOptions() {
    const counts = new Map();

    for (const entity of this._entities) {
      if (!this._matchesEntityfilters(entity, { ignoreExcludedPlatforms: true })) {
        continue;
      }

      const platform = entity.platform || "__none__";
      counts.set(platform, (counts.get(platform) || 0) + 1);
    }

    return [...counts.entries()]
      .map(([platform, count]) => ({
        platform,
        label: this._integrationLabel(platform),
        count,
        excluded: this._excludedPlatforms.has(platform),
      }))
      .sort((a, b) => {
        if (a.excluded !== b.excluded) return a.excluded ? -1 : 1;
        return a.label.localeCompare(
          b.label,
          this._hass?.language || "de",
          { sensitivity: "base", numeric: true }
        );
      });
  }

  async _ensureAliasIndex() {
    if (this._aliasIndexReady) return true;

    if (!this._aliasIndexLoading) {
      await this._loadAliasIndex();
      return this._aliasIndexReady;
    }

    while (this._aliasIndexLoading) {
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }

    return this._aliasIndexReady;
  }

  async _exportConfiguration() {
    if (this._exportBusy) return;

    this._exportBusy = true;
    this._importError = "";
    this._importSuccess = "";
    this._render();

    try {
      const aliasesReady = await this._ensureAliasIndex();
      if (!aliasesReady) {
        throw new Error(
          "Aliases could not be fully loaded. Export was cancelled."
        );
      }

      const assistants = this._activeAssistants.map((assistant) => ({
        id: assistant.id,
        label: assistant.label,
      }));

      const payload = {
        schema: "assist-entity-manager-export",
        schema_version: AEM_BACKUP_SCHEMA_VERSION,
        plugin_version: "1.0.0",
        exported_at: new Date().toISOString(),
        active_assistants: assistants,
        manager_preferences: {
          ignored_conflict_entity_ids: [
            ...(this._preferences.ignoredConflictEntityIds || []),
          ],
        },
        entities: this._entities.map((entity) => ({
          entity_id: entity.entityId,
          use_entity_name_as_alias: Boolean(entity.useEntityNameAlias),
          aliases: Array.isArray(entity.aliases) ? [...entity.aliases] : [],
          exposure: Object.fromEntries(
            assistants.map((assistant) => [
              assistant.id,
              this._exposureState(entity.entityId, assistant.id) === "exposed",
            ])
          ),
        })),
      };

      const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .replace("Z", "");

      anchor.href = url;
      anchor.download = `assist-entity-manager-backup_${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      this._importSuccess =
        `Export created: ${payload.entities.length} entities, ${assistants.length} active voice assistants.`;
    } catch (err) {
      console.error("Assist Entity Manager: Export", err);
      this._importError = err?.message || "Export failed.";
    } finally {
      this._exportBusy = false;
      this._render();
    }
  }

  _migrateImportPayload(data) {
    if (!data || typeof data !== "object") {
      throw new Error("The file does not contain a valid JSON object.");
    }

    if (data.schema !== "assist-entity-manager-export") {
      throw new Error("The file is not an Assist Entity Manager backup.");
    }

    if (!Number.isInteger(data.schema_version)) {
      throw new Error("The backup is missing a valid schema version.");
    }

    if (data.schema_version > AEM_BACKUP_SCHEMA_VERSION) {
      throw new Error(
        `This backup uses schema ${data.schema_version}. This version of Assist Entity Manager supports up to schema ${AEM_BACKUP_SCHEMA_VERSION}. Please update Assist Entity Manager first.`
      );
    }

    if (data.schema_version < AEM_BACKUP_MIN_SCHEMA_VERSION) {
      throw new Error(
        `Backup schema ${data.schema_version} is not supported.`
      );
    }

    // Clone before migration. Import must never mutate the parsed source object.
    const migrated = JSON.parse(JSON.stringify(data));

    while (migrated.schema_version < AEM_BACKUP_SCHEMA_VERSION) {
      switch (migrated.schema_version) {
        case 1:
          // Schema 1 -> 2:
          // v1 did not store the standard-name/null-alias state or manager
          // preferences. We intentionally leave use_entity_name_as_alias absent;
          // the import code then preserves the current HA setting for that entity.
          migrated.manager_preferences =
            migrated.manager_preferences &&
            typeof migrated.manager_preferences === "object"
              ? migrated.manager_preferences
              : {};
          migrated.schema_version = 2;
          break;
        default:
          throw new Error(
            `No migration is available for backup schema ${migrated.schema_version}.`
          );
      }
    }

    return migrated;
  }

  _validateImportPayload(data) {
    const migrated = this._migrateImportPayload(data);

    if (!Array.isArray(migrated.entities)) {
      throw new Error("The entity list is missing from the backup.");
    }

    return migrated;
  }

  async _prepareImportFile(file) {
    if (!file || this._importBusy) return;

    if (file.size > 10 * 1024 * 1024) {
      this._importError = "The import file is larger than 10 MB and was not loaded for security reasons.";
      this._importPreview = null;
      this._render();
      return;
    }

    this._importError = "";
    this._importSuccess = "";
    this._importPreview = null;
    this._importFileName = file.name || "Backup.json";
    this._importBusy = true;
    this._render();

    try {
      const aliasesReady = await this._ensureAliasIndex();
      if (!aliasesReady) {
        throw new Error(
          "Current aliases could not be loaded. Import preview was cancelled."
        );
      }

      const raw = await file.text();
      const data = this._validateImportPayload(JSON.parse(raw));

      const currentById = new Map(
        this._entities.map((entity) => [entity.entityId, entity])
      );
      const activeAssistantIds = new Set(this._assistantIds());

      let matching = 0;
      let missing = 0;
      let aliasChanges = 0;
      let exposureChanges = 0;
      let unsupportedExposureChanges = 0;
      const inactiveAssistants = new Set();

      const normalizedEntities = [];

      const aliasesEqual = (a, b) => {
        const left = [...(a || [])].map(String).sort();
        const right = [...(b || [])].map(String).sort();
        return JSON.stringify(left) === JSON.stringify(right);
      };

      for (const item of data.entities) {
        if (!item || typeof item.entity_id !== "string") continue;

        const current = currentById.get(item.entity_id);
        if (!current) {
          missing += 1;
          continue;
        }

        matching += 1;

        const aliases = Array.isArray(item.aliases)
          ? item.aliases
              .filter((alias) => typeof alias === "string" && alias.trim())
              .map((alias) => alias.trim())
          : [];

        // Schema v1 did not store the Default name/null-alias setting.
        // Old backups therefore leave the current HA setting untouched.
        const useEntityNameAlias =
          typeof item.use_entity_name_as_alias === "boolean"
            ? item.use_entity_name_as_alias
            : Boolean(current.useEntityNameAlias);

        const exposure =
          item.exposure && typeof item.exposure === "object"
            ? item.exposure
            : {};

        const aliasChanged =
          !aliasesEqual(current.aliases, aliases) ||
          Boolean(current.useEntityNameAlias) !== useEntityNameAlias;
        if (aliasChanged) aliasChanges += 1;

        const exposureDiffs = [];
        for (const [assistantId, desiredValue] of Object.entries(exposure)) {
          if (!activeAssistantIds.has(assistantId)) {
            inactiveAssistants.add(assistantId);
            continue;
          }

          if (typeof desiredValue !== "boolean") continue;

          if (
            desiredValue === true &&
            this._assistantSupportState(assistantId, item.entity_id) ===
              "unsupported"
          ) {
            unsupportedExposureChanges += 1;
            continue;
          }

          const currentValue =
            this._exposureState(item.entity_id, assistantId) === "exposed";
          if (currentValue !== desiredValue) {
            exposureChanges += 1;
            exposureDiffs.push({
              assistantId,
              desired: desiredValue,
            });
          }
        }

        if (aliasChanged || exposureDiffs.length) {
          normalizedEntities.push({
            entityId: item.entity_id,
            aliases,
            useEntityNameAlias,
            aliasChanged,
            exposureDiffs,
          });
        }
      }

      const currentIgnored = new Set(
        this._preferences.ignoredConflictEntityIds || []
      );
      const importedIgnored =
        Array.isArray(data.manager_preferences?.ignored_conflict_entity_ids)
          ? new Set(
              data.manager_preferences.ignored_conflict_entity_ids.filter(
                (entityId) => currentById.has(entityId)
              )
            )
          : null;

      let ignoredConflictChanges = 0;
      if (importedIgnored) {
        const union = new Set([...currentIgnored, ...importedIgnored]);
        ignoredConflictChanges = [...union].filter(
          (entityId) =>
            currentIgnored.has(entityId) !== importedIgnored.has(entityId)
        ).length;
      }

      this._importPreview = {
        data,
        changes: normalizedEntities,
        importedIgnoredConflictIds: importedIgnored
          ? [...importedIgnored]
          : null,
        stats: {
          fileEntities: data.entities.length,
          matching,
          missing,
          aliasChanges,
          exposureChanges,
          unsupportedExposureChanges,
          ignoredConflictChanges,
          changedEntities:
            normalizedEntities.length + (ignoredConflictChanges ? 1 : 0),
          inactiveAssistants: [...inactiveAssistants],
        },
      };
    } catch (err) {
      console.error("Assist Entity Manager: Import preview", err);
      this._importError =
        err?.message || "The import file could not be read.";
    } finally {
      this._importBusy = false;
      this._render();
    }
  }

  async _applyImport() {
    const preview = this._importPreview;
    if (!preview || this._importBusy) return;

    this._importBusy = true;
    this._importError = "";
    this._importSuccess = "";
    this._render();

    let aliasApplied = 0;
    let exposureApplied = 0;
    const failures = [];

    try {
      for (const change of preview.changes) {
        if (!change.aliasChanged) continue;

        try {
          const aliasesToSave = [
            ...(change.useEntityNameAlias ? [null] : []),
            ...change.aliases,
          ];

          const result = await this._callWS({
            type: "config/entity_registry/update",
            entity_id: change.entityId,
            aliases: aliasesToSave,
          });

          const savedRawAliases = Array.isArray(result?.aliases)
            ? result.aliases
            : aliasesToSave;
          const savedAliases = savedRawAliases.filter(
            (alias) => typeof alias === "string" && alias.trim()
          );

          const entity = this._entities.find(
            (item) => item.entityId === change.entityId
          );
          if (entity) {
            entity.aliases = [...savedAliases];
            entity.useEntityNameAlias = savedRawAliases.includes(null);
          }

          aliasApplied += 1;
        } catch (err) {
          failures.push(
            `${change.entityId}: Aliases – ${err?.message || "Error"}`
          );
        }

        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }

      const batches = new Map();

      for (const change of preview.changes) {
        for (const diff of change.exposureDiffs) {
          const key = `${diff.assistantId}:${diff.desired ? "1" : "0"}`;
          if (!batches.has(key)) {
            batches.set(key, {
              assistantId: diff.assistantId,
              desired: diff.desired,
              entityIds: [],
            });
          }
          batches.get(key).entityIds.push(change.entityId);
        }
      }

      for (const batch of batches.values()) {
        try {
          await this._callWS({
            type: "homeassistant/expose_entity",
            assistants: [batch.assistantId],
            entity_ids: batch.entityIds,
            should_expose: batch.desired,
          });

          for (const entityId of batch.entityIds) {
            this._exposed[entityId] = {
              ...(this._exposed[entityId] || {}),
              [batch.assistantId]: batch.desired,
            };
          }

          exposureApplied += batch.entityIds.length;
        } catch (err) {
          failures.push(
            `${this._assistantById(batch.assistantId).label}: exposure settings – ${
              err?.message || "Error"
            }`
          );
        }
      }

      if (Array.isArray(preview.importedIgnoredConflictIds)) {
        this._preferences.ignoredConflictEntityIds = [
          ...preview.importedIgnoredConflictIds,
        ];
        this._savePreferences();
      }

      this._rebuildSpokenNameIndex();
      this._updateChangeWatchBaseline();

      this._importSuccess =
        `Import completed: ${aliasApplied} alias sets and ${exposureApplied} exposure settings changed.` +
        (failures.length
          ? ` ${failures.length} partial change(s) could not be applied.`
          : "");

      if (failures.length) {
        this._importError = failures.slice(0, 6).join(" | ");
      }

      this._importPreview = null;
    } catch (err) {
      console.error("Assist Entity Manager: Import", err);
      this._importError = err?.message || "Import failed.";
    } finally {
      this._importBusy = false;
      this._render();
    }
  }

  _renderConflictOverview(conflictGroups) {
    const ambiguous = this._ambiguousEntities();

    return `
      <div class="conflict-view">
        <div class="conflict-view-head">
          <div>
            <div class="conflict-view-kicker">CHECK SPOKEN NAMES</div>
            <h2>Conflict overview</h2>
            <p>
              Only real overlaps appear here: the same name or alias is assigned to at least two entities.
            </p>
          </div>
          <button class="btn secondary leave-conflicts" type="button">
            <ha-icon icon="mdi:arrow-left"></ha-icon>
            Zur entity list
          </button>
        </div>

        <div class="conflict-summary-card">
          <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
          <div>
            <strong>${conflictGroups.length} ${
              conflictGroups.length === 1 ? "Conflict" : "Conflicts"
            }</strong>
            <span>${this._conflictEntityIds.size} betroffene entities</span>
          </div>
        </div>

        <div class="conflict-groups">
          ${conflictGroups
            .map(
              (group) => `
                <section class="conflict-group-card">
                  <div class="conflict-group-name">
                    <ha-icon icon="mdi:message-alert-outline"></ha-icon>
                    <div>
                      <small>Duplicate spoken name</small>
                      <strong>„${this._escape(group.spokenName)}“</strong>
                      <span class="conflict-assistants">
                        ${group.assistants
                          .map(
                            (assistant) => `
                              <span>
                                ${this._assistantIconMarkup(assistant)}
                                ${this._escape(assistant.shortLabel)}
                              </span>
                            `
                          )
                          .join("")}
                      </span>
                    </div>
                  </div>

                  <div class="conflict-group-entities">
                    ${group.entities
                      .map(
                        (entry) => `
                          <div class="conflict-overview-entry">
                            <button
                              class="conflict-overview-entity"
                              type="button"
                              data-conflict-entity="${this._escapeAttr(entry.entityId)}"
                            >
                              <span>
                                <strong>${this._escape(entry.name)}</strong>
                                <small>
                                  ${this._escape(entry.entityId)}
                                  ${entry.areaName ? ` · ${this._escape(entry.areaName)}` : ""}
                                </small>
                              </span>
                              <span class="conflict-source-badges">
                                ${entry.sources
                                  .map(
                                    (source) =>
                                      `<span>${this._escape(source)}</span>`
                                  )
                                  .join("")}
                              </span>
                              <ha-icon icon="mdi:chevron-right"></ha-icon>
                            </button>
                            <button
                              class="ignore-conflict-entity"
                              type="button"
                              data-ignore-conflict="${this._escapeAttr(entry.entityId)}"
                              title="Ignore conflict warnings for this entity"
                            >
                              <ha-icon icon="mdi:bell-off-outline"></ha-icon>
                              Ignore
                            </button>
                          </div>
                        `
                      )
                      .join("")}
                  </div>
                </section>
              `
            )
            .join("")}
        </div>

        ${
          this._preferences.detectAmbiguousNames && ambiguous.length
            ? `
              <section class="ambiguous-overview">
                <div class="ambiguous-overview-head">
                  <ha-icon icon="mdi:help-circle-outline"></ha-icon>
                  <div>
                    <h3>Potentially ambiguous names</h3>
                    <p>
                      These are not confirmed conflicts. The names are simply very generic, e.g. “Light” or “Temperature”.
                    </p>
                  </div>
                  <span>${ambiguous.length}</span>
                </div>

                <div class="ambiguous-list">
                  ${ambiguous
                    .slice(0, 100)
                    .map(
                      ({ entity, issues }) => `
                        <button
                          class="ambiguous-entity"
                          type="button"
                          data-conflict-entity="${this._escapeAttr(entity.entityId)}"
                        >
                          <span>
                            <strong>${this._escape(entity.name)}</strong>
                            <small>${this._escape(entity.entityId)}${
                              entity.areaName ? ` · ${this._escape(entity.areaName)}` : ""
                            }</small>
                          </span>
                          <span class="ambiguous-reason">
                            ${this._escape(issues[0].reason)}
                          </span>
                          <ha-icon icon="mdi:chevron-right"></ha-icon>
                        </button>
                      `
                    )
                    .join("")}
                </div>
              </section>
            `
            : ""
        }
      </div>
    `;
  }

  _renderUtilityPanel() {
    if (!this._utilityPanel) return "";

    if (this._utilityPanel === "settings") {
      const unnecessaryCount = this._unnecessaryEntities().length;
      const ambiguousCount = this._ambiguousEntities().length;
      const ignoredConflictCount = (
        this._preferences.ignoredConflictEntityIds || []
      ).length;

      return `
        <div class="utility-backdrop">
          <section class="utility-panel" role="dialog" aria-modal="true" aria-label="Assist Entity Manager Settings">
            <div class="utility-header">
              <div>
                <div class="detail-eyebrow">EINSTELLUNGEN</div>
                <h2>Voice-control helpers</h2>
                <p>Hints only – the plugin never automatically blocks entities based on this detection.</p>
              </div>
              <button class="icon-btn utility-close" type="button" title="Close">
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </div>

            <div class="utility-content">
              <label class="setting-row">
                <span class="setting-icon">
                  <ha-icon icon="mdi:broom"></ha-icon>
                </span>
                <span class="setting-copy">
                  <strong>Detect probably unnecessary entities</strong>
                  <small>
                    Marks diagnostic, configuration, signal-strength, update and typical maintenance entities.
                  </small>
                  <em>${unnecessaryCount} currently detected</em>
                </span>
                <span class="mini-switch setting-switch">
                  <input
                    id="setting-detect-unnecessary"
                    type="checkbox"
                    ${this._preferences.detectUnnecessary ? "checked" : ""}
                  >
                  <span class="mini-slider"></span>
                </span>
              </label>

              <label class="setting-row nested ${this._preferences.detectUnnecessary ? "" : "disabled-setting"}">
                <span class="setting-icon muted">
                  <ha-icon icon="mdi:eye-off-outline"></ha-icon>
                </span>
                <span class="setting-copy">
                  <strong>Hide detected entities</strong>
                  <small>
                    Entfernt sie nur aus dieser Ansicht. In Home Assistant selbst is nichts changed.
                  </small>
                </span>
                <span class="mini-switch setting-switch">
                  <input
                    id="setting-hide-unnecessary"
                    type="checkbox"
                    ${this._preferences.hideUnnecessary ? "checked" : ""}
                    ${this._preferences.detectUnnecessary ? "" : "disabled"}
                  >
                  <span class="mini-slider"></span>
                </span>
              </label>

              <label class="setting-row">
                <span class="setting-icon warning">
                  <ha-icon icon="mdi:help-circle-outline"></ha-icon>
                </span>
                <span class="setting-copy">
                  <strong>Detect potentially ambiguous names</strong>
                  <small>
                    Warnt bei sehr allgemeinen spoken Namen wie „Light“, „Switch“ oder „Temperature“.
                  </small>
                  <em>${ambiguousCount} currentlye hints</em>
                </span>
                <span class="mini-switch setting-switch">
                  <input
                    id="setting-detect-ambiguous"
                    type="checkbox"
                    ${this._preferences.detectAmbiguousNames ? "checked" : ""}
                  >
                  <span class="mini-slider"></span>
                </span>
              </label>

              <div class="setting-row static-setting">
                <span class="setting-icon muted">
                  <ha-icon icon="mdi:bell-off-outline"></ha-icon>
                </span>
                <span class="setting-copy">
                  <strong>Ignored conflict warnings</strong>
                  <small>
                    Entities whose name overlaps you intentionally ignore. This setting is local to Assist Entity Manager only.
                  </small>
                  <em>${ignoredConflictCount} currently ignored</em>
                </span>
                <button
                  class="btn secondary clear-ignored-conflicts"
                  type="button"
                  ${ignoredConflictCount ? "" : "disabled"}
                >
                  Re-enable all
                </button>
              </div>

              ${
                ignoredConflictCount
                  ? `<div class="ignored-conflict-list">
                      ${(this._preferences.ignoredConflictEntityIds || [])
                        .map((entityId) => {
                          const entity = this._entities.find(
                            (item) => item.entityId === entityId
                          );
                          return `
                            <label class="ignored-conflict-list-row">
                              <span class="ignored-conflict-list-icon">
                                <ha-icon icon="mdi:bell-off-outline"></ha-icon>
                              </span>
                              <span class="ignored-conflict-list-copy">
                                <strong>${this._escape(
                                  entity?.name || entityId
                                )}</strong>
                                <small>
                                  ${this._escape(entityId)}
                                  ${
                                    entity?.areaName
                                      ? ` · ${this._escape(entity.areaName)}`
                                      : ""
                                  }
                                </small>
                              </span>
                              <span class="mini-switch setting-switch">
                                <input
                                  class="ignored-conflict-toggle"
                                  type="checkbox"
                                  data-ignored-entity="${this._escapeAttr(entityId)}"
                                  checked
                                  aria-label="Conflict warnings for ${this._escapeAttr(
                                    entity?.name || entityId
                                  )} ignorieren"
                                >
                                <span class="mini-slider"></span>
                              </span>
                            </label>
                          `;
                        })
                        .join("")}
                    </div>`
                  : ""
              }

              <div class="settings-explanation">
                <ha-icon icon="mdi:information-outline"></ha-icon>
                <div>
                  <strong>How “unnecessary” is determined</strong>
                  <span>
                    Detection is intentionally conservative. It uses HA category, device class and typical technical names. A hint is a recommendation, not a claim that the entity can never be useful.
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      `;
    }

    if (this._utilityPanel === "backup") {
      const preview = this._importPreview?.stats;

      return `
        <div class="utility-backdrop">
          <section class="utility-panel backup-panel" role="dialog" aria-modal="true" aria-label="Export and import">
            <div class="utility-header">
              <div>
                <div class="detail-eyebrow">SICHERUNG</div>
                <h2>Export & import</h2>
                <p>Back up or restore aliases and exposure for currently active voice assistants.</p>
              </div>
              <button class="icon-btn utility-close" type="button" title="Close">
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </div>

            <div class="utility-content">
              ${
                this._importError
                  ? `<div class="utility-message error-message">${this._escape(this._importError)}</div>`
                  : ""
              }
              ${
                this._importSuccess
                  ? `<div class="utility-message success-message">${this._escape(this._importSuccess)}</div>`
                  : ""
              }

              <section class="backup-section">
                <div class="backup-section-icon">
                  <ha-icon icon="mdi:database-export-outline"></ha-icon>
                </div>
                <div class="backup-section-copy">
                  <h3>Configuration exportieren</h3>
                  <p>
                    Exports all existing aliases and exposure status for the currently shown voice assistants as JSON.
                  </p>
                  <button class="btn primary export-config" type="button" ${
                    this._exportBusy || this._importBusy ? "disabled" : ""
                  }>
                    <ha-icon icon="mdi:download"></ha-icon>
                    ${this._exportBusy ? "Creating export …" : "Export JSON backup"}
                  </button>
                </div>
              </section>

              <section class="backup-section">
                <div class="backup-section-icon">
                  <ha-icon icon="mdi:database-import-outline"></ha-icon>
                </div>
                <div class="backup-section-copy">
                  <h3>Configuration importieren</h3>
                  <p>
                    A preview is created first. Changes are only sent to Home Assistant after your second click.
                  </p>

                  <input
                    id="import-file"
                    class="hidden-file"
                    type="file"
                    accept=".json,application/json"
                  >

                  <button class="btn secondary choose-import" type="button" ${
                    this._importBusy ? "disabled" : ""
                  }>
                    <ha-icon icon="mdi:file-upload-outline"></ha-icon>
                    Choose backup file
                  </button>

                  ${
                    this._importFileName
                      ? `<div class="selected-file">${this._escape(this._importFileName)}</div>`
                      : ""
                  }
                </div>
              </section>

              ${
                preview
                  ? `
                    <section class="import-preview">
                      <div class="import-preview-head">
                        <ha-icon icon="mdi:clipboard-check-outline"></ha-icon>
                        <div>
                          <h3>Import preview</h3>
                          <p>Nothing has been changed yet.</p>
                        </div>
                      </div>

                      <div class="preview-metrics">
                        <div><strong>${preview.fileEntities}</strong><span>in file</span></div>
                        <div><strong>${preview.matching}</strong><span>found</span></div>
                        <div><strong>${preview.changedEntities}</strong><span>with changes</span></div>
                        <div><strong>${preview.aliasChanges}</strong><span>alias changes</span></div>
                        <div><strong>${preview.exposureChanges}</strong><span>exposure changes</span></div>
                        <div><strong>${preview.ignoredConflictChanges || 0}</strong><span>ignore rules</span></div>
                        <div><strong>${preview.missing}</strong><span>missing</span></div>
                      </div>

                      ${
                        preview.inactiveAssistants.length
                          ? `<div class="import-note">
                              Assistants from the file that are not active are skipped: ${preview.inactiveAssistants
                                .map((id) => this._escape(this._assistantById(id).label))
                                .join(", ")}
                            </div>`
                          : ""
                      }
                      ${
                        preview.unsupportedExposureChanges
                          ? `<div class="import-note">
                              ${preview.unsupportedExposureChanges} exposure setting(s) are skipped because Home Assistant reports that the target voice assistant does not support this entity.
                            </div>`
                          : ""
                      }

                      <div class="import-safety">
                        <ha-icon icon="mdi:shield-check-outline"></ha-icon>
                        <span>
                          Unknown entities are ignored. Entities not included in the file are not changed.
                        </span>
                      </div>

                      <button
                        class="btn primary apply-import"
                        type="button"
                        ${preview.changedEntities && !this._importBusy ? "" : "disabled"}
                      >
                        <ha-icon icon="mdi:database-check-outline"></ha-icon>
                        ${
                          this._importBusy
                            ? "Importing …"
                            : preview.changedEntities
                            ? `${preview.changedEntities} Import entities`
                            : "No changes needed"
                        }
                      </button>
                    </section>
                  `
                  : ""
              }
            </div>
          </section>
        </div>
      `;
    }

    return "";
  }

  async _setExposure(entityIds, shouldExpose, assistantIds = null) {
    if (!entityIds.length) return;

    const requestedAssistants = Array.isArray(assistantIds)
      ? assistantIds
      : assistantIds
      ? [assistantIds]
      : this._bulkAssistant
      ? [this._bulkAssistant]
      : [];

    const allowed = new Set(this._assistantIds());
    const assistants = requestedAssistants.filter((id) => allowed.has(id));

    if (!assistants.length) {
      this._error = "No enabled voice assistant selected for this action.";
      this._render();
      return;
    }

    this._error = "";
    this._actionNotice = "";
    this._setBusy(true);

    let skippedUnsupported = 0;

    try {
      for (const assistant of assistants) {
        const eligibleEntityIds = shouldExpose
          ? entityIds.filter((entityId) => {
              const unsupported =
                this._assistantSupportState(assistant, entityId) ===
                "unsupported";
              if (unsupported) skippedUnsupported += 1;
              return !unsupported;
            })
          : [...entityIds];

        if (!eligibleEntityIds.length) continue;

        await this._callWS({
          type: "homeassistant/expose_entity",
          assistants: [assistant],
          entity_ids: eligibleEntityIds,
          should_expose: shouldExpose,
        });

        for (const entityId of eligibleEntityIds) {
          const current = { ...(this._exposed[entityId] || {}) };
          current[assistant] = shouldExpose;
          this._exposed[entityId] = current;
        }
      }

      if (skippedUnsupported) {
        this._actionNotice =
          `${skippedUnsupported} exposure${
            skippedUnsupported === 1 ? "" : "n"
          } setting${skippedUnsupported === 1 ? "" : "s"} skipped because Home Assistant reports that the voice assistant does not support the entity.`;
      }

      if (this._aliasIndexReady) {
        this._rebuildSpokenNameIndex();
      }

      this._updateChangeWatchBaseline();
      this._render();
    } catch (err) {
      console.error("Assist Entity Manager:", err);
      this._error = err?.message || String(err);
      this._render();
    } finally {
      this._setBusy(false);
    }
  }

  _setBusy(busy) {
    this._busy = busy;
    const host = this.shadowRoot.querySelector(".card");
    if (host) host.classList.toggle("busy", Boolean(busy));
    this.shadowRoot
      .querySelectorAll("button, input, select")
      .forEach((el) => {
        if (el.dataset.keepEnabled !== "true") el.disabled = Boolean(busy);
      });
  }

  _selectVisible() {
    for (const entity of this._filteredEntities()) {
      this._selected.add(entity.entityId);
    }
    this._render();
  }

  _clearSelection() {
    this._selected.clear();
    this._render();
  }

  _render() {
    if (!this.shadowRoot) return;

    const filtered = this._loaded ? this._filteredEntities() : [];
    const deviceGroups = this._groupByDevice ? this._deviceGroups(filtered) : [];
    const pageInfo = this._groupByDevice
      ? this._groupPageInfo(deviceGroups)
      : this._pageInfo(filtered);
    const pageRows = this._groupByDevice ? [] : pageInfo.rows;
    const pageGroups = this._groupByDevice ? pageInfo.groups : [];
    const total = this._entities.length;
    const exposedCount = this._entities.filter((e) => this._isExposed(e.entityId)).length;
    const notExposedCount = Math.max(0, total - exposedCount);
    const exposedPercent = total ? Math.round((exposedCount / total) * 100) : 0;
    const activeAssistants = this._activeAssistants;
    const assistantCounts = new Map(
      activeAssistants.map((assistant) => [
        assistant.id,
        this._assistantExposedCount(assistant.id),
      ])
    );

    const areas = [...this._areas.values()].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", this._hass?.language || "de")
    );

    const domains = [...new Set(this._entities.map((e) => e.domain))].sort();
    const integrationOptions = this._integrationfilterOptions();
    const excludedPlatforms = [...this._excludedPlatforms];
    const conflictGroups = this._exactConflictGroups();
    const ambiguousEntities = this._ambiguousEntities();
    const unnecessaryEntities = this._unnecessaryEntities();
    const externalChanges = this._externalChanges || [];

    if (
      this._specialView === "conflicts" &&
      this._aliasIndexReady &&
      !conflictGroups.length
    ) {
      this._specialView = "";
    }

    if (this._loaded) {
      this._saveViewState();
    }

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card class="card">
        <div class="hero">
          <div class="hero-copy">
            <div class="eyebrow">
              <span class="eyebrow-dot"></span>
              HOME ASSISTANT SPRACHASSISTENTEN
            </div>
            <h1>Assist Entity Manager</h1>
            <p class="subtitle">
              See at a glance which active voice assistant may use which entity – including aliases.
            </p>
          </div>

          <div class="hero-actions">
            <div class="assist-summary">
              <div class="assist-summary-icon">
                <ha-icon icon="mdi:message-processing-outline"></ha-icon>
              </div>
              <div>
                <div class="assist-summary-label">Exposed at least once</div>
                <div class="assist-summary-value">${exposedCount} <span>von ${total}</span></div>
              </div>
              <div class="assist-summary-percent">${exposedPercent}%</div>
            </div>

            <button class="hero-tool-btn open-backup" type="button" title="Export & import">
              <ha-icon icon="mdi:database-sync-outline"></ha-icon>
              <span>Backup</span>
            </button>

            <button class="hero-tool-btn open-settings" type="button" title="Settings">
              <ha-icon icon="mdi:tune-variant"></ha-icon>
              <span>Settings</span>
            </button>

            <button class="icon-btn refresh" title="Reload" data-keep-enabled="true">
              <ha-icon icon="mdi:refresh"></ha-icon>
            </button>
          </div>
        </div>

        ${
          this._error
            ? `<div class="error"><strong>Error:</strong> ${this._escape(this._error)}</div>`
            : ""
        }

        ${
          this._actionNotice
            ? `<div class="action-notice">
                <ha-icon icon="mdi:information-outline"></ha-icon>
                <span>${this._escape(this._actionNotice)}</span>
              </div>`
            : ""
        }

        ${
          this._loading
            ? `<div class="loading"><span class="spinner"></span>Loading data …</div>`
            : ""
        }

        ${
          this._loaded
            ? `
          <div class="status-tabs" role="tablist" aria-label="exposurestatus">
            <button class="status-tab ${this._specialView === "" && this._filters.status === "" ? "active" : ""}" data-status="">
              <span class="tab-icon all"><ha-icon icon="mdi:format-list-bulleted"></ha-icon></span>
              <span class="tab-copy">
                <strong>All</strong>
                <small>${total} entities</small>
              </span>
            </button>

            <button class="status-tab exposed ${this._specialView === "" && this._filters.status === "exposed" ? "active" : ""}" data-status="exposed">
              <span class="tab-icon on"><ha-icon icon="mdi:check-circle"></ha-icon></span>
              <span class="tab-copy">
                <strong>Exposed</strong>
                <small>${exposedCount} bei mindestens einem Assistenten aktiv</small>
              </span>
            </button>

            <button class="status-tab not-exposed ${this._specialView === "" && this._filters.status === "not_exposed" ? "active" : ""}" data-status="not_exposed">
              <span class="tab-icon off"><ha-icon icon="mdi:eye-off-outline"></ha-icon></span>
              <span class="tab-copy">
                <strong>Not exposed</strong>
                <small>${notExposedCount} inactive</small>
              </span>
            </button>

            ${
              this._aliasIndexReady && conflictGroups.length
                ? `
                  <button class="conflict-tab ${this._specialView === "conflicts" ? "active" : ""}" type="button">
                    <span class="tab-icon conflict-icon">
                      <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
                    </span>
                    <span class="tab-copy">
                      <strong>Conflicts</strong>
                      <small>${conflictGroups.length} ${
                        conflictGroups.length === 1 ? "Doppelung" : "Doppelungen"
                      }</small>
                    </span>
                  </button>
                `
                : ""
            }
          </div>

          ${
            this._specialView === "conflicts"
              ? this._aliasIndexReady
                ? this._renderConflictOverview(conflictGroups)
                : `<div class="conflict-loading"><span class="spinner"></span>Checking conflicts using aliases and active exposure settings …</div>`
              : `
          ${
            activeAssistants.length
              ? `
                <div class="active-assistants">
                  <span class="active-assistants-label">Active in Home Assistant:</span>
                  ${activeAssistants
                    .map(
                      (assistant) => `
                        <span class="active-assistant-chip">
                          ${this._assistantIconMarkup(assistant)}
                          <span>${this._escape(assistant.label)}</span>
                          <strong>${assistantCounts.get(assistant.id) || 0}</strong>
                        </span>
                      `
                    )
                    .join("")}
                </div>
              `
              : `
                <div class="no-assistants-note">
                  <ha-icon icon="mdi:account-voice-off"></ha-icon>
                  <span>No supported voice assistant is currently enabled in Home Assistant settings. Entity and alias management still works.</span>
                </div>
              `
          }

          ${
            (
              externalChanges.length ||
              (this._preferences.detectUnnecessary && unnecessaryEntities.length) ||
              (this._preferences.detectAmbiguousNames && ambiguousEntities.length)
            )
              ? `
                <div class="quality-strip">
                  ${
                    externalChanges.length
                      ? `<button
                          class="quality-summary external-change show-external-changes-filter"
                          type="button"
                          title="Show exposure/support changes detected outside this manager"
                        >
                          <ha-icon icon="mdi:history-alert-outline"></ha-icon>
                          ${externalChanges.length} ${
                            externalChanges.length === 1
                              ? "exposure change"
                              : "exposure changeen"
                          }
                          <ha-icon class="quality-summary-arrow" icon="mdi:arrow-right"></ha-icon>
                        </button>`
                      : ""
                  }

                  ${
                    this._preferences.detectUnnecessary && unnecessaryEntities.length
                      ? `<span class="quality-summary unnecessary">
                          <ha-icon icon="mdi:broom"></ha-icon>
                          ${unnecessaryEntities.length} probably unnecessary
                          ${
                            this._preferences.hideUnnecessary
                              ? `<strong>ausgeblendet</strong>`
                              : ""
                          }
                        </span>`
                      : ""
                  }

                  ${
                    this._preferences.detectAmbiguousNames && ambiguousEntities.length
                      ? `<button
                          class="quality-summary ambiguous show-ambiguous-filter"
                          type="button"
                          title="Show only entities with naming hints"
                        >
                          <ha-icon icon="mdi:help-circle-outline"></ha-icon>
                          ${ambiguousEntities.length} name hints
                          <ha-icon class="quality-summary-arrow" icon="mdi:arrow-right"></ha-icon>
                        </button>`
                      : ""
                  }

                  <button class="quality-settings-link" type="button">
                    Settings
                  </button>
                </div>
              `
              : ""
          }

          <div class="filters-panel">
            <label class="search-wrap">
              <ha-icon class="search-icon" icon="mdi:magnify"></ha-icon>
              <input id="search" type="search"
                placeholder="Search name, entity ID, device or integration …"
                value="${this._escapeAttr(this._filters.search)}">
            </label>

            ${
              this._qualityfilter === "ambiguous" ||
              this._qualityfilter === "external_changes"
                ? `
                  <div class="active-quality-filters">
                    <span class="active-quality-label">Active filter:</span>
                    ${
                      this._qualityfilter === "ambiguous"
                        ? `<button
                            class="active-quality-chip clear-ambiguous-filter"
                            type="button"
                            title="Remove naming-hints filter"
                          >
                            <ha-icon icon="mdi:help-circle-outline"></ha-icon>
                            <span>name hints</span>
                            <ha-icon class="active-quality-close" icon="mdi:close"></ha-icon>
                          </button>`
                        : `<button
                            class="active-quality-chip external clear-external-changes-filter"
                            type="button"
                            title="Remove exposure-changes filter"
                          >
                            <ha-icon icon="mdi:history-alert-outline"></ha-icon>
                            <span>exposure changeen</span>
                            <ha-icon class="active-quality-close" icon="mdi:close"></ha-icon>
                          </button>
                          <button
                            class="btn secondary acknowledge-external-changes"
                            type="button"
                          >
                            <ha-icon icon="mdi:check-all"></ha-icon>
                            Als gesehen markieren
                          </button>`
                    }
                  </div>

                  ${
                    this._qualityfilter === "external_changes"
                      ? `<div class="external-change-history">
                          ${externalChanges
                            .slice()
                            .reverse()
                            .slice(0, 20)
                            .map((change) => {
                              const entityExists = this._entities.some(
                                (entity) => entity.entityId === change.entityId
                              );
                              return `
                                <div class="external-change-item ${
                                  entityExists ? "" : "missing"
                                }">
                                  <ha-icon icon="${
                                    change.kind === "missing"
                                      ? "mdi:alert-circle-outline"
                                      : change.kind === "support"
                                      ? "mdi:alert-octagon-outline"
                                      : change.after
                                      ? "mdi:toggle-switch-outline"
                                      : "mdi:toggle-switch-off-outline"
                                  }"></ha-icon>
                                  <span class="external-change-copy">
                                    <strong>${this._escape(
                                      change.entityName || change.entityId
                                    )}</strong>
                                    <small>
                                      ${this._escape(
                                        this._externalChangeDescription(change)
                                      )}
                                      ${
                                        change.detectedAt
                                          ? ` · ${this._escape(
                                              this._formatChangeTime(
                                                change.detectedAt
                                              )
                                            )}`
                                          : ""
                                      }
                                    </small>
                                  </span>
                                  ${
                                    entityExists
                                      ? `<button
                                          class="external-change-open"
                                          type="button"
                                          data-change-entity="${this._escapeAttr(
                                            change.entityId
                                          )}"
                                          title="Open entity"
                                        >
                                          <ha-icon icon="mdi:chevron-right"></ha-icon>
                                        </button>`
                                      : `<span class="external-change-missing-label">missing</span>`
                                  }
                                </div>
                              `;
                            })
                            .join("")}
                        </div>`
                      : ""
                  }
                `
                : ""
            }

            <div class="filter-row">
              <select id="area-filter">
                <option value="">All areas</option>
                ${areas
                  .map(
                    (area) =>
                      `<option value="${this._escapeAttr(area.area_id)}" ${
                        this._filters.area === area.area_id ? "selected" : ""
                      }>${this._escape(area.name || area.area_id)}</option>`
                  )
                  .join("")}
                <option value="__none__" ${
                  this._filters.area === "__none__" ? "selected" : ""
                }>No area</option>
              </select>

              <select id="domain-filter">
                <option value="">All domains</option>
                ${domains
                  .map(
                    (domain) =>
                      `<option value="${this._escapeAttr(domain)}" ${
                        this._filters.domain === domain ? "selected" : ""
                      }>${this._escape(domain)}</option>`
                  )
                  .join("")}
              </select>

              <select id="status-filter">
                <option value="">All exposure statuses</option>
                <option value="exposed" ${
                  this._filters.status === "exposed" ? "selected" : ""
                }>Exposed</option>
                <option value="not_exposed" ${
                  this._filters.status === "not_exposed" ? "selected" : ""
                }>Not exposed</option>
              </select>

              <select id="category-filter">
                <option value="">All categories</option>
                <option value="normal" ${
                  this._filters.category === "normal" ? "selected" : ""
                }>Normal entities only</option>
                <option value="config" ${
                  this._filters.category === "config" ? "selected" : ""
                }>Configuration</option>
                <option value="diagnostic" ${
                  this._filters.category === "diagnostic" ? "selected" : ""
                }>Diagnostic</option>
              </select>
            </div>

            <div class="exclude-filter">
              <details class="exclude-dropdown" ${this._excludeDropdownOpen ? "open" : ""}>
                <summary>
                  <span class="exclude-summary-main">
                    <ha-icon icon="mdi:filter-minus-outline"></ha-icon>
                    <span>Exclude integrations</span>
                  </span>
                  <span class="exclude-summary-count">
                    ${excludedPlatforms.length}
                  </span>
                  <ha-icon class="exclude-chevron" icon="mdi:chevron-down"></ha-icon>
                </summary>

                <div class="exclude-menu">
                  <div class="exclude-menu-head">
                    <div>
                      <strong>Hide integrations</strong>
                      <small>Counts respect your other filters.</small>
                    </div>
                    ${
                      excludedPlatforms.length
                        ? `<button class="clear-exclusions" type="button">Remove all</button>`
                        : ""
                    }
                  </div>

                  <div class="exclude-options">
                    ${
                      integrationOptions.length
                        ? integrationOptions.map((option) => `
                            <label class="exclude-option">
                              <input
                                class="exclude-integration-checkbox"
                                type="checkbox"
                                data-platform="${this._escapeAttr(option.platform)}"
                                ${option.excluded ? "checked" : ""}
                              >
                              <span class="exclude-option-copy">
                                <strong>${this._escape(option.label)}</strong>
                                <small>
                                  ${option.platform !== "__none__" ? `${this._escape(option.platform)} · ` : ""}
                                  ${option.count} ${option.count === 1 ? "Entity" : "entities"}
                                </small>
                              </span>
                            </label>
                          `).join("")
                        : `<div class="exclude-empty">No integrations for the current filters.</div>`
                    }
                  </div>
                </div>
              </details>

              ${
                excludedPlatforms.length
                  ? `
                    <div class="exclude-chips" aria-label="Excluded integrations">
                      <span class="exclude-chips-label">Ausgeschlossen:</span>
                      ${excludedPlatforms
                        .sort((a, b) =>
                          this._integrationLabel(a).localeCompare(
                            this._integrationLabel(b),
                            this._hass?.language || "de",
                            { sensitivity: "base", numeric: true }
                          )
                        )
                        .map((platform) => `
                          <button
                            class="exclude-chip remove-exclusion"
                            type="button"
                            data-platform="${this._escapeAttr(platform)}"
                            title="${this._escapeAttr(this._integrationLabel(platform))} show again"
                          >
                            <span>${this._escape(this._integrationLabel(platform))}</span>
                            <ha-icon icon="mdi:close"></ha-icon>
                          </button>
                        `)
                        .join("")}
                    </div>
                  `
                  : ""
              }
            </div>
          </div>

          <div class="actions">
            <div class="results-info">
              <strong>${filtered.length}</strong> sichtbar
              ${this._selected.size ? `<span class="selection-count">• ${this._selected.size} selected</span>` : ""}
            </div>

            <div class="action-buttons">
              <button
                class="btn ${this._groupByDevice ? "primary-soft" : "secondary"} toggle-grouping"
                type="button"
                title="Group entities by their Home Assistant device"
              >
                <ha-icon icon="mdi:devices"></ha-icon>
                ${this._groupByDevice ? "Device grouping active" : "Group by device"}
              </button>

              ${
                activeAssistants.length
                  ? `
                    <label class="bulk-assistant">
                      <span>Bulk action for</span>
                      <select id="bulk-assistant-select">
                        ${activeAssistants
                          .map(
                            (assistant) => `
                              <option value="${this._escapeAttr(assistant.id)}" ${
                                this._bulkAssistant === assistant.id ? "selected" : ""
                              }>
                                ${this._escape(assistant.label)}
                              </option>
                            `
                          )
                          .join("")}
                      </select>
                    </label>
                  `
                  : ""
              }

              <button class="btn secondary select-visible">
                <ha-icon icon="mdi:checkbox-multiple-marked-outline"></ha-icon>
                Select visible
              </button>
              ${
                this._selected.size
                  ? `<button class="btn ghost clear-selection">
                      <ha-icon icon="mdi:close"></ha-icon>
                      Clear selection
                    </button>`
                  : ""
              }
              <button class="btn danger bulk-off" ${
                this._selected.size && activeAssistants.length ? "" : "disabled"
              }>
                <ha-icon icon="mdi:eye-off-outline"></ha-icon>
                Sperren
              </button>
              <button class="btn primary bulk-on" ${
                this._selected.size && activeAssistants.length ? "" : "disabled"
              }>
                <ha-icon icon="mdi:check-circle-outline"></ha-icon>
                Freigeben
              </button>
            </div>
          </div>

          <div class="list-shell">
            <div class="table-head">
              <div></div>
              <div>Entity</div>
              <div>Area & device</div>
              <div>Voice assistants</div>
            </div>

            <div id="entity-list" class="entity-list ${this._groupByDevice ? "group-mode" : ""}">
              ${
                this._groupByDevice
                  ? this._renderDeviceGroups(pageGroups)
                  : this._renderRows(pageRows)
              }
            </div>

            ${
              !filtered.length
                ? `<div class="empty">
                    <ha-icon icon="mdi:magnify-close"></ha-icon>
                    <strong>No matching entities</strong>
                    <span>Change the search or filters.</span>
                  </div>`
                : ""
            }
          </div>

          ${
            filtered.length
              ? `
                <div class="pager">
                  <div class="pager-info">
                    ${
                      this._groupByDevice
                        ? `Devices ${pageInfo.start + 1}–${pageInfo.end} of ${deviceGroups.length}`
                        : `${pageInfo.start + 1}–${pageInfo.end} von ${filtered.length}`
                    }
                    <span>• ${
                      this._groupByDevice
                        ? `up to ${this._groupPageSize} device groups per page`
                        : `up to ${this._pageSize} entities at once`
                    }</span>
                  </div>
                  <div class="pager-controls">
                    <button class="pager-btn first-page" type="button" ${this._page <= 1 ? "disabled" : ""} title="First page">
                      <ha-icon icon="mdi:page-first"></ha-icon>
                    </button>
                    <button class="pager-btn prev-page" type="button" ${this._page <= 1 ? "disabled" : ""} title="Previous page">
                      <ha-icon icon="mdi:chevron-left"></ha-icon>
                    </button>
                    <span class="pager-page">Page ${this._page} / ${pageInfo.totalPages}</span>
                    <button class="pager-btn next-page" type="button" ${this._page >= pageInfo.totalPages ? "disabled" : ""} title="Next page">
                      <ha-icon icon="mdi:chevron-right"></ha-icon>
                    </button>
                    <button class="pager-btn last-page" type="button" ${this._page >= pageInfo.totalPages ? "disabled" : ""} title="Last page">
                      <ha-icon icon="mdi:page-last"></ha-icon>
                    </button>
                  </div>
                </div>
              `
              : ""
          }

          <div class="footer-note">
            <span><strong>Exposed</strong> = at least one currently shown voice assistant may use the entity.</span>
            <span>View and change individual exposure settings directly on the right of each row.</span>
            <span><ha-icon class="footer-inline-icon" icon="mdi:history"></ha-icon> Search and filters are restored when navigating back during this session.</span>
          </div>
          `
            }
        `
            : ""
        }
      </ha-card>
      ${this._renderDetails()}
      ${this._renderUtilityPanel()}
    `;

    this._bindEvents();
    this._setBusy(Boolean(this._busy));
  }

  _renderRowsOnly() {
    if (!this._loaded) return;
    const list = this.shadowRoot.querySelector("#entity-list");
    if (!list) return;
    const filtered = this._filteredEntities();
    if (this._groupByDevice) {
      const groups = this._deviceGroups(filtered);
      list.innerHTML = this._renderDeviceGroups(this._groupPageInfo(groups).groups);
    } else {
      list.innerHTML = this._renderRows(this._pageInfo(filtered).rows);
    }
    this._bindRowEvents();
  }

  _renderDeviceGroups(groups) {
    return groups
      .map((group) => {
        const expanded = this._expandedGroups.has(group.key);
        const device = group.device;
        const manufacturer = device?.manufacturer || "";
        const model = device?.model || "";
        const meta = [manufacturer, model].filter(Boolean).join(" · ");
        const exposedCount = group.entities.filter((entity) =>
          this._isExposed(entity.entityId)
        ).length;

        return `
          <section class="device-group ${expanded ? "expanded" : ""}">
            <button
              class="device-group-header"
              type="button"
              data-group-key="${this._escapeAttr(group.key)}"
              aria-expanded="${expanded ? "true" : "false"}"
            >
              <span class="device-group-chevron">
                <ha-icon icon="${expanded ? "mdi:chevron-down" : "mdi:chevron-right"}"></ha-icon>
              </span>

              <span class="device-group-icon">
                <ha-icon icon="${group.deviceId ? "mdi:devices" : "mdi:cube-outline"}"></ha-icon>
              </span>

              <span class="device-group-copy">
                <strong>${this._escape(group.name)}</strong>
                <small>
                  ${this._escape(group.areaName)}
                  ${meta ? ` · ${this._escape(meta)}` : ""}
                </small>
              </span>

              <span class="device-group-platforms">
                ${[...group.platforms]
                  .slice(0, 3)
                  .map(
                    (platform) =>
                      `<span class="group-platform-chip">${this._escape(platform)}</span>`
                  )
                  .join("")}
              </span>

              <span class="device-group-counts">
                <span>${group.entities.length} ${group.entities.length === 1 ? "Entity" : "entities"}</span>
                <strong>${exposedCount} exposed</strong>
              </span>
            </button>

            ${
              expanded
                ? `
                  <div class="device-group-entities">
                    ${this._renderRows(group.entities, true)}
                  </div>
                `
                : ""
            }
          </section>
        `;
      })
      .join("");
  }

  _renderRows(entities, grouped = false) {
    const activeAssistants = this._activeAssistants;

    return entities
      .map((entity) => {
        const summary = this._exposureSummary(entity.entityId);
        const checked = this._selected.has(entity.entityId);
        const areaText = entity.areaName || "No area";
        const deviceText = entity.deviceName || "No device";
        const meta = [entity.entityId, entity.platform ? `via ${entity.platform}` : ""]
          .filter(Boolean)
          .join(" · ");

        const categoryLabel =
          entity.category === "diagnostic"
            ? "Diagnostic"
            : entity.category === "config"
            ? "Configuration"
            : "";
        const deviceClassInfo = this._deviceClassDisplay(entity);

        const isOn = summary === "exposed";
        const exposedAssistantCount = activeAssistants.filter(
          (assistant) =>
            this._exposureState(entity.entityId, assistant.id) === "exposed"
        ).length;

        return `
          <div class="entity-row ${isOn ? "assist-enabled" : "assist-disabled"} ${
            entity.hidden ? "is-hidden" : ""
          } ${grouped ? "grouped-row" : ""}" data-entity="${this._escapeAttr(entity.entityId)}" title="Click for details">

            <label class="select-cell" title="Select">
              <input class="row-select" type="checkbox" ${
                checked ? "checked" : ""
              } aria-label="${this._escapeAttr(entity.name)} select">
            </label>

            <div class="entity-main">
              <div class="entity-icon ${isOn ? "enabled" : ""}">
                <ha-icon icon="${this._domainIcon(entity.domain)}"></ha-icon>
              </div>

              <div class="entity-text">
                <div class="name-line">
                  <span class="entity-name">${this._escape(entity.name)}</span>
                  <span class="domain-chip">${this._escape(entity.domain)}</span>
                  ${
                    categoryLabel
                      ? `<span class="category-chip">${categoryLabel}</span>`
                      : ""
                  }
                  ${
                    deviceClassInfo.label
                      ? `<span class="device-class-chip" title="HA device class: ${this._escapeAttr(
                          deviceClassInfo.raw
                        )}">${this._escape(deviceClassInfo.label)}</span>`
                      : ""
                  }
                  ${
                    this._aliasIndexReady
                      ? entity.useEntityNameAlias
                        ? `<span class="quality-chip spoken-name-chip" title="The default name is used by Home Assistant as the first alias.">
                            <ha-icon icon="mdi:account-voice"></ha-icon>
                            Default name active
                          </span>`
                        : entity.aliases?.length
                        ? `<span class="quality-chip spoken-name-off-chip" title="The default name is off. Only the configured aliases are used as spoken names.">
                            <ha-icon icon="mdi:account-voice-off"></ha-icon>
                            Aliases only (${entity.aliases.length})
                          </span>`
                        : `<span class="quality-chip spoken-name-off-chip" title="Neither the default name nor additional aliases are configured as spoken names.">
                            <ha-icon icon="mdi:account-voice-off"></ha-icon>
                            No spoken name
                          </span>`
                      : ""
                  }
                  ${
                    this._isConflictIgnored(entity.entityId)
                      ? `<span class="quality-chip ignored-conflict-chip" title="Conflict warnings for this entity are ignored in Assist Entity Manager.">
                          <ha-icon icon="mdi:bell-off-outline"></ha-icon>
                          Conflicts ignored
                        </span>`
                      : ""
                  }
                  ${
                    this._externalChangesForEntity(entity.entityId).length
                      ? `<span
                          class="quality-chip external-change-chip"
                          title="${this._escapeAttr(
                            this._externalChangeDescription(
                              this._externalChangesForEntity(entity.entityId).slice(-1)[0]
                            )
                          )}"
                        >
                          <ha-icon icon="mdi:history-alert-outline"></ha-icon>
                          Extern changed
                        </span>`
                      : ""
                  }
                  ${
                    this._entityHasExactConflict(entity.entityId)
                      ? `<span class="quality-chip conflict-chip" title="At least one name or alias is also used by another entity.">
                          <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
                          Name conflict
                        </span>`
                      : ""
                  }
                  ${
                    this._ambiguousNameIssues(entity).length
                      ? `<span class="quality-chip ambiguous-chip" title="${this._escapeAttr(
                          this._ambiguousNameIssues(entity)[0].reason
                        )}">
                          <ha-icon icon="mdi:help-circle-outline"></ha-icon>
                          Ambiguous?
                        </span>`
                      : ""
                  }
                  ${
                    this._unnecessaryInfo(entity)
                      ? `<span class="quality-chip unnecessary-chip" title="${this._escapeAttr(
                          this._unnecessaryInfo(entity).reason
                        )}">
                          <ha-icon icon="mdi:broom"></ha-icon>
                          Probably unnecessary
                        </span>`
                      : ""
                  }
                </div>
                <div class="entity-id">${this._escape(meta)}</div>
              </div>
            </div>

            <div class="location-cell">
              <div class="location-line">
                <ha-icon icon="mdi:floor-plan"></ha-icon>
                <span>${this._escape(areaText)}</span>
              </div>
              <div class="location-line secondary-location">
                <ha-icon icon="mdi:devices"></ha-icon>
                <span>${this._escape(deviceText)}</span>
              </div>
            </div>

            <div class="assist-cell">
              ${
                activeAssistants.length
                  ? `
                    <div class="assistant-switches">
                      ${activeAssistants
                        .map((assistant) => {
                          const assistantOn =
                            this._exposureState(
                              entity.entityId,
                              assistant.id
                            ) === "exposed";
                          const supportState = this._assistantSupportState(
                            assistant.id,
                            entity.entityId
                          );
                          const unsupported = supportState === "unsupported";

                          return `
                            <label
                              class="assistant-mini ${assistantOn ? "on" : ""} ${
                                unsupported ? "unsupported" : ""
                              }"
                              title="${this._escapeAttr(assistant.label)}: ${
                                unsupported
                                  ? "not supported"
                                  : assistantOn
                                  ? "exposed"
                                  : "nicht exposed"
                              }"
                            >
                              <span class="assistant-mini-label">
                                ${this._assistantIconMarkup(assistant)}
                                <span>${this._escape(assistant.shortLabel)}</span>
                                ${
                                  unsupported
                                    ? `<span
                                        class="mini-unsupported-icon"
                                        title="${this._escapeAttr(
                                          `${assistant.label}: Not supported – Home Assistant reports that this entity is not supported by this voice assistant.`
                                        )}"
                                        aria-label="${this._escapeAttr(
                                          `${assistant.label}: Not supported`
                                        )}"
                                      >
                                        <ha-icon icon="mdi:alert-circle"></ha-icon>
                                      </span>`
                                    : ""
                                }
                              </span>
                              <span class="mini-switch">
                                <input
                                  class="assistant-toggle"
                                  type="checkbox"
                                  data-assistant="${this._escapeAttr(assistant.id)}"
                                  ${assistantOn ? "checked" : ""}
                                  ${unsupported && !assistantOn ? "disabled" : ""}
                                  aria-label="${this._escapeAttr(
                                    assistant.label
                                  )}-exposure for ${this._escapeAttr(entity.name)}"
                                >
                                <span class="mini-slider"></span>
                              </span>
                            </label>
                          `;
                        })
                        .join("")}
                    </div>
                    <small class="assistant-count">
                      ${exposedAssistantCount} von ${activeAssistants.length} exposed
                    </small>
                  `
                  : `<span class="status status-default">No assistant active</span>`
              }
            </div>
          </div>
        `;
      })
      .join("");
  }

  _bindEvents() {
    this.shadowRoot
      .querySelector(".refresh")
      ?.addEventListener("click", () => {
        this._loaded = false;
        this._load();
      });

    this.shadowRoot.querySelector(".open-settings")?.addEventListener("click", () => {
      this._utilityPanel = "settings";
      this._render();
    });

    this.shadowRoot.querySelector(".quality-settings-link")?.addEventListener("click", () => {
      this._utilityPanel = "settings";
      this._render();
    });

    this.shadowRoot
      .querySelector(".show-external-changes-filter")
      ?.addEventListener("click", () => {
        if (!this._externalChanges.length) return;

        this._specialView = "";
        this._utilityPanel = "";
        this._qualityfilter = "external_changes";
        this._filters.search = "";
        this._filters.area = "";
        this._filters.domain = "";
        this._filters.status = "";
        this._filters.category = "";
        this._excludedPlatforms.clear();
        this._groupByDevice = false;
        this._page = 1;
        this._render();
      });

    this.shadowRoot
      .querySelector(".clear-external-changes-filter")
      ?.addEventListener("click", () => {
        this._qualityfilter = "";
        this._page = 1;
        this._render();
      });

    this.shadowRoot
      .querySelector(".acknowledge-external-changes")
      ?.addEventListener("click", () => {
        this._acknowledgeExternalChanges();
      });

    this.shadowRoot
      .querySelectorAll(".external-change-open")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const entityId = button.dataset.changeEntity;
          if (entityId) this._openDetails(entityId);
        });
      });

    this.shadowRoot
      .querySelector(".show-ambiguous-filter")
      ?.addEventListener("click", () => {
        const ambiguous = this._ambiguousEntities();
        if (!ambiguous.length) return;

        this._specialView = "";
        this._utilityPanel = "";
        this._qualityfilter = "ambiguous";

        // Clear filters that could otherwise hide the affected entity/entities.
        this._filters.area = "";
        this._filters.domain = "";
        this._filters.status = "";
        this._filters.category = "";
        this._excludedPlatforms.clear();

        // If there is exactly one hint, behave like a manual search and fill
        // the visible search field with that entity's name.
        this._filters.search =
          ambiguous.length === 1 ? ambiguous[0].entity.name : "";

        // Show actual entity rows immediately instead of collapsed device groups.
        this._groupByDevice = false;
        this._page = 1;
        this._render();

        requestAnimationFrame(() => {
          const input = this.shadowRoot.querySelector("#search");
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        });
      });

    this.shadowRoot
      .querySelector(".clear-ambiguous-filter")
      ?.addEventListener("click", () => {
        this._qualityfilter = "";
        this._page = 1;
        this._render();
      });

    this.shadowRoot.querySelector(".open-backup")?.addEventListener("click", () => {
      this._utilityPanel = "backup";
      this._importError = "";
      this._importSuccess = "";
      this._render();
    });

    this.shadowRoot.querySelector(".utility-close")?.addEventListener("click", () => {
      this._utilityPanel = "";
      this._render();
    });

    this.shadowRoot.querySelector(".utility-backdrop")?.addEventListener("click", (event) => {
      if (event.target.classList.contains("utility-backdrop")) {
        this._utilityPanel = "";
        this._render();
      }
    });

    this.shadowRoot
      .querySelector("#setting-detect-unnecessary")
      ?.addEventListener("change", (event) => {
        this._preferences.detectUnnecessary = event.target.checked;
        if (!event.target.checked) {
          this._preferences.hideUnnecessary = false;
        }
        this._savePreferences();
        this._page = 1;
        this._render();
      });

    this.shadowRoot
      .querySelector("#setting-hide-unnecessary")
      ?.addEventListener("change", (event) => {
        this._preferences.hideUnnecessary = event.target.checked;
        this._savePreferences();
        this._page = 1;
        this._render();
      });

    this.shadowRoot
      .querySelector("#setting-detect-ambiguous")
      ?.addEventListener("change", (event) => {
        this._preferences.detectAmbiguousNames = event.target.checked;
        if (!event.target.checked) {
          this._qualityfilter = "";
        }
        this._savePreferences();
        this._page = 1;
        this._render();
      });

    this.shadowRoot
      .querySelector(".clear-ignored-conflicts")
      ?.addEventListener("click", () => {
        this._clearIgnoredConflicts();
      });

    this.shadowRoot
      .querySelectorAll(".ignored-conflict-toggle")
      .forEach((toggle) => {
        toggle.addEventListener("change", (event) => {
          const entityId = event.target.dataset.ignoredEntity;
          if (!entityId) return;
          this._setConflictIgnored(entityId, event.target.checked);
        });
      });

    this.shadowRoot.querySelector(".export-config")?.addEventListener("click", () => {
      this._exportConfiguration();
    });

    this.shadowRoot.querySelector(".choose-import")?.addEventListener("click", () => {
      this.shadowRoot.querySelector("#import-file")?.click();
    });

    this.shadowRoot.querySelector("#import-file")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) this._prepareImportFile(file);
    });

    this.shadowRoot.querySelector(".apply-import")?.addEventListener("click", () => {
      this._applyImport();
    });

    this.shadowRoot.querySelectorAll(".conflict-overview-entity, .ambiguous-entity").forEach((button) => {
      button.addEventListener("click", () => {
        const entityId = button.dataset.conflictEntity;
        if (entityId) this._openDetails(entityId);
      });
    });

    this.shadowRoot.querySelectorAll(".ignore-conflict-entity").forEach((button) => {
      button.addEventListener("click", () => {
        const entityId = button.dataset.ignoreConflict;
        if (entityId) this._setConflictIgnored(entityId, true);
      });
    });

    const search = this.shadowRoot.querySelector("#search");
    search?.addEventListener("input", (event) => {
      const value = event.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._filters.search = value;
        this._page = 1;
        this._render();
        requestAnimationFrame(() => {
          const input = this.shadowRoot.querySelector("#search");
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        });
      }, 180);
    });

    this.shadowRoot.querySelectorAll(".status-tab").forEach((button) => {
      button.addEventListener("click", () => {
        this._specialView = "";
        this._filters.status = button.dataset.status || "";
        this._page = 1;
        this._render();
      });
    });

    this.shadowRoot.querySelector(".conflict-tab")?.addEventListener("click", () => {
      this._specialView = "conflicts";
      this._render();
    });

    this.shadowRoot.querySelector(".leave-conflicts")?.addEventListener("click", () => {
      this._specialView = "";
      this._render();
    });

    const bindfilter = (selector, key, transform = (v) => v) => {
      this.shadowRoot.querySelector(selector)?.addEventListener("change", (event) => {
        this._filters[key] = transform(event.target.value);
        this._page = 1;
        this._render();
      });
    };

    bindfilter("#area-filter", "area", (value) => value);
    bindfilter("#domain-filter", "domain");
    bindfilter("#status-filter", "status");
    bindfilter("#category-filter", "category");

    this.shadowRoot
      .querySelector(".toggle-grouping")
      ?.addEventListener("click", () => {
        this._groupByDevice = !this._groupByDevice;
        this._page = 1;
        this._render();
      });

    this.shadowRoot
      .querySelector("#bulk-assistant-select")
      ?.addEventListener("change", (event) => {
        this._bulkAssistant = event.target.value;
        this._saveViewState();
      });

    const excludeDropdown = this.shadowRoot.querySelector(".exclude-dropdown");
    excludeDropdown?.addEventListener("toggle", () => {
      this._excludeDropdownOpen = excludeDropdown.open;
    });

    this.shadowRoot
      .querySelectorAll(".exclude-integration-checkbox")
      .forEach((checkbox) => {
        checkbox.addEventListener("change", (event) => {
          const platform = event.target.dataset.platform;
          if (!platform) return;

          if (event.target.checked) {
            this._excludedPlatforms.add(platform);
          } else {
            this._excludedPlatforms.delete(platform);
          }

          this._excludeDropdownOpen = true;
          this._page = 1;
          this._render();
        });
      });

    this.shadowRoot
      .querySelectorAll(".remove-exclusion")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const platform = button.dataset.platform;
          if (!platform) return;

          this._excludedPlatforms.delete(platform);
          this._page = 1;
          this._render();
        });
      });

    this.shadowRoot
      .querySelector(".clear-exclusions")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        this._excludedPlatforms.clear();
        this._excludeDropdownOpen = false;
        this._page = 1;
        this._render();
      });

    this.shadowRoot
      .querySelector(".select-visible")
      ?.addEventListener("click", () => this._selectVisible());

    this.shadowRoot
      .querySelector(".clear-selection")
      ?.addEventListener("click", () => this._clearSelection());

    this.shadowRoot.querySelector(".bulk-on")?.addEventListener("click", () => {
      this._setExposure([...this._selected], true, [this._bulkAssistant]);
    });

    this.shadowRoot.querySelector(".bulk-off")?.addEventListener("click", () => {
      this._setExposure([...this._selected], false, [this._bulkAssistant]);
    });

    this.shadowRoot.querySelector(".first-page")?.addEventListener("click", () => {
      this._page = 1;
      this._render();
    });

    this.shadowRoot.querySelector(".prev-page")?.addEventListener("click", () => {
      this._page = Math.max(1, this._page - 1);
      this._render();
    });

    this.shadowRoot.querySelector(".next-page")?.addEventListener("click", () => {
      const filtered = this._filteredEntities();
      const totalPages = this._groupByDevice
        ? this._groupPageInfo(this._deviceGroups(filtered)).totalPages
        : this._pageInfo(filtered).totalPages;
      this._page = Math.min(totalPages, this._page + 1);
      this._render();
    });

    this.shadowRoot.querySelector(".last-page")?.addEventListener("click", () => {
      const filtered = this._filteredEntities();
      this._page = this._groupByDevice
        ? this._groupPageInfo(this._deviceGroups(filtered)).totalPages
        : this._pageInfo(filtered).totalPages;
      this._render();
    });

    this.shadowRoot.querySelector(".detail-close")?.addEventListener("click", () => {
      this._closeDetails();
    });

    this.shadowRoot.querySelector(".detail-backdrop")?.addEventListener("click", (event) => {
      if (event.target.classList.contains("detail-backdrop")) {
        this._closeDetails();
      }
    });

    this.shadowRoot
      .querySelector("#detail-area-select")
      ?.addEventListener("change", (event) => {
        this._saveEntityAssignment("area", event.target.value);
      });

    this.shadowRoot
      .querySelector("#detail-device-select")
      ?.addEventListener("change", (event) => {
        this._saveEntityAssignment("device", event.target.value);
      });

    this.shadowRoot
      .querySelectorAll(".detail-assistant-toggle")
      .forEach((toggle) => {
        toggle.addEventListener("change", async (event) => {
          const desired = event.target.checked;
          const assistant = event.target.dataset.assistant;
          if (!assistant) return;
          await this._setExposure(
            [this._detailEntityId],
            desired,
            [assistant]
          );
        });
      });

    this.shadowRoot
      .querySelector("#detail-entity-name-alias")
      ?.addEventListener("change", (event) => {
        this._toggleEntityNameAlias(event.target.checked);
      });

    this.shadowRoot
      .querySelector("#detail-ignore-conflicts")
      ?.addEventListener("change", (event) => {
        if (!this._detailEntityId) return;
        this._setConflictIgnored(
          this._detailEntityId,
          event.target.checked
        );
      });

    this.shadowRoot.querySelector(".add-alias")?.addEventListener("click", () => {
      this._addAliasFromInput();
    });

    this.shadowRoot.querySelector("#alias-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this._addAliasFromInput();
      }
    });

    this.shadowRoot.querySelectorAll(".remove-alias").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number.parseInt(button.dataset.aliasIndex || "", 10);
        this._removeAliasAt(index);
      });
    });

    this.shadowRoot.querySelectorAll(".conflict-entity-link").forEach((button) => {
      button.addEventListener("click", () => {
        const entityId = button.dataset.conflictEntity;
        if (entityId) this._openDetails(entityId);
      });
    });

    this.shadowRoot.querySelector(".open-ha-entity")?.addEventListener("click", (event) => {
      const entityId = event.currentTarget.dataset.entity;
      if (entityId) this._openEntityInHA(entityId);
    });

    this.shadowRoot.querySelector(".open-ha-device")?.addEventListener("click", (event) => {
      const deviceId = event.currentTarget.dataset.device;
      if (deviceId) this._openDeviceInHA(deviceId);
    });

    this._bindRowEvents();
  }

  _bindRowEvents() {
    this.shadowRoot.querySelectorAll(".device-group-header").forEach((header) => {
      header.addEventListener("click", () => {
        const key = header.dataset.groupKey;
        if (!key) return;

        if (this._expandedGroups.has(key)) {
          this._expandedGroups.delete(key);
        } else {
          this._expandedGroups.add(key);
        }
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll(".entity-row").forEach((row) => {
      const entityId = row.dataset.entity;

      row.addEventListener("click", (event) => {
        if (event.target.closest("input, label, button, a, select")) return;
        this._openDetails(entityId);
      });

      row.querySelector(".row-select")?.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      row.querySelector(".row-select")?.addEventListener("change", (event) => {
        if (event.target.checked) this._selected.add(entityId);
        else this._selected.delete(entityId);
        this._render();
      });

      row.querySelectorAll(".assistant-toggle").forEach((toggle) => {
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        toggle.addEventListener("change", (event) => {
          const desired = event.target.checked;
          const assistant = event.target.dataset.assistant;
          if (!assistant) return;
          this._setExposure([entityId], desired, [assistant]);
        });
      });
    });
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _escapeAttr(value) {
    return this._escape(value);
  }

  _styles() {
    return `
      :host {
        display: block;
        width: 100%;
        max-width: none;
        grid-column: 1 / -1;
        --aem-success: var(--success-color, #43a047);
        --aem-danger: var(--error-color, #e53935);
      }

      * {
        box-sizing: border-box;
      }

      ha-icon {
        --mdc-icon-size: 20px;
      }

      .card {
        width: 100%;
        max-width: none;
        overflow: hidden;
        color: var(--primary-text-color);
        background:
          radial-gradient(circle at 95% -10%, color-mix(in srgb, var(--primary-color) 11%, transparent), transparent 32%),
          var(--ha-card-background, var(--card-background-color));
        border-radius: 22px;
        transition: opacity .18s ease;
      }

      .card.busy {
        opacity: .72;
      }

      .hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 26px 28px 22px;
        border-bottom: 1px solid var(--divider-color);
      }

      .hero-copy {
        min-width: 0;
      }

      .eyebrow {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 11px;
        letter-spacing: .12em;
        font-weight: 800;
        color: var(--primary-color);
      }

      .eyebrow-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--aem-success);
        box-shadow: 0 0 0 5px color-mix(in srgb, var(--aem-success) 12%, transparent);
      }

      h1 {
        margin: 0;
        font-size: clamp(24px, 2.4vw, 34px);
        line-height: 1.15;
        letter-spacing: -.025em;
      }

      .subtitle {
        margin: 7px 0 0;
        max-width: 700px;
        color: var(--secondary-text-color);
        font-size: 14px;
        line-height: 1.5;
      }

      .hero-actions {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .assist-summary {
        display: grid;
        grid-template-columns: auto auto auto;
        align-items: center;
        gap: 12px;
        min-width: 260px;
        padding: 12px 14px;
        border: 1px solid color-mix(in srgb, var(--aem-success) 28%, var(--divider-color));
        border-radius: 16px;
        background: color-mix(in srgb, var(--aem-success) 8%, var(--secondary-background-color));
      }

      .assist-summary-icon {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        border-radius: 13px;
        color: var(--aem-success);
        background: color-mix(in srgb, var(--aem-success) 14%, transparent);
      }

      .assist-summary-label {
        font-size: 11px;
        font-weight: 750;
        color: var(--secondary-text-color);
      }

      .assist-summary-value {
        margin-top: 2px;
        font-size: 19px;
        font-weight: 850;
      }

      .assist-summary-value span {
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
      }

      .assist-summary-percent {
        margin-left: auto;
        padding: 6px 8px;
        border-radius: 9px;
        font-size: 12px;
        font-weight: 850;
        color: var(--aem-success);
        background: color-mix(in srgb, var(--aem-success) 12%, transparent);
      }

      .hero-tool-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 46px;
        padding: 0 12px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        font-weight: 750;
      }

      .hero-tool-btn:hover {
        border-color: color-mix(in srgb, var(--primary-color) 45%, var(--divider-color));
        background: color-mix(in srgb, var(--primary-color) 6%, var(--secondary-background-color));
      }

      .hero-tool-btn ha-icon {
        color: var(--primary-color);
        --mdc-icon-size: 18px;
      }

      .conflict-tab {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        min-height: 68px;
        padding: 12px 14px;
        text-align: left;
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
        border: 1px solid color-mix(in srgb, var(--aem-danger) 26%, var(--divider-color));
        border-radius: 16px;
        cursor: pointer;
        transition: transform .14s ease, border-color .14s ease, background .14s ease;
      }

      .conflict-tab:hover {
        transform: translateY(-1px);
      }

      .conflict-tab.active {
        border-color: color-mix(in srgb, var(--aem-danger) 60%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-danger) 8%, var(--secondary-background-color));
      }

      .conflict-icon {
        color: var(--aem-danger);
        background: color-mix(in srgb, var(--aem-danger) 10%, transparent);
      }

      .quality-strip {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 14px 28px 0;
      }

      .quality-summary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 9px;
        border-radius: 999px;
        border: 1px solid var(--divider-color);
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        font: inherit;
        font-size: 10px;
        font-weight: 700;
      }

      button.quality-summary {
        cursor: pointer;
        transition: background .14s ease, border-color .14s ease, transform .14s ease;
      }

      button.quality-summary:hover {
        transform: translateY(-1px);
        background: color-mix(in srgb, var(--warning-color, #f9a825) 7%, var(--secondary-background-color));
      }

      .quality-summary-arrow {
        margin-left: 1px;
        --mdc-icon-size: 13px !important;
      }

      .quality-summary ha-icon {
        --mdc-icon-size: 15px;
      }

      .quality-summary.unnecessary ha-icon {
        color: var(--secondary-text-color);
      }

      .quality-summary.external-change {
        color: var(--warning-color, #f9a825);
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 34%, var(--divider-color));
        background: color-mix(in srgb, var(--warning-color, #f9a825) 8%, var(--secondary-background-color));
      }

      .quality-summary.external-change ha-icon {
        color: var(--warning-color, #f9a825);
      }

      .quality-summary.ambiguous {
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 28%, var(--divider-color));
      }

      .quality-summary.ambiguous ha-icon {
        color: var(--warning-color, #f9a825);
      }

      .quality-summary strong {
        color: var(--primary-color);
        font-size: 9px;
      }

      .quality-settings-link {
        border: 0;
        background: transparent;
        color: var(--primary-color);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        font-weight: 750;
      }

      .quality-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border-radius: 999px;
        padding: 4px 7px;
        font-size: 9px;
        line-height: 1;
        font-weight: 780;
        border: 1px solid var(--divider-color);
      }

      .quality-chip ha-icon {
        --mdc-icon-size: 12px;
      }

      .external-change-chip {
        color: var(--warning-color, #f9a825);
        background: color-mix(in srgb, var(--warning-color, #f9a825) 8%, var(--secondary-background-color));
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 28%, var(--divider-color));
      }

      .conflict-chip {
        color: var(--aem-danger);
        border-color: color-mix(in srgb, var(--aem-danger) 30%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-danger) 7%, transparent);
      }

      .ambiguous-chip {
        color: var(--warning-color, #f9a825);
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 30%, var(--divider-color));
        background: color-mix(in srgb, var(--warning-color, #f9a825) 7%, transparent);
      }

      .unnecessary-chip {
        color: var(--secondary-text-color);
        background: var(--secondary-background-color);
      }

      .detail-quality-warnings {
        display: grid;
        gap: 8px;
        margin: 16px 24px 0;
      }

      .detail-quality-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        align-items: flex-start;
        padding: 10px 11px;
        border-radius: 12px;
        border: 1px solid var(--divider-color);
        background: var(--secondary-background-color);
      }

      .detail-quality-item ha-icon {
        --mdc-icon-size: 17px;
      }

      .detail-quality-item strong,
      .detail-quality-item span {
        display: block;
      }

      .detail-quality-item strong {
        font-size: 11px;
      }

      .detail-quality-item span {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.4;
      }

      .detail-quality-item.conflict {
        border-color: color-mix(in srgb, var(--aem-danger) 30%, var(--divider-color));
      }

      .detail-quality-item.conflict ha-icon {
        color: var(--aem-danger);
      }

      .detail-quality-item.warning {
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 30%, var(--divider-color));
      }

      .detail-quality-item.warning ha-icon {
        color: var(--warning-color, #f9a825);
      }

      .utility-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10020;
        display: flex;
        justify-content: flex-end;
        background: rgba(0, 0, 0, .38);
        backdrop-filter: blur(2px);
      }

      .utility-panel {
        width: min(620px, 96vw);
        height: 100%;
        overflow-y: auto;
        background: var(--card-background-color, var(--ha-card-background));
        color: var(--primary-text-color);
        border-left: 1px solid var(--divider-color);
        box-shadow: -16px 0 44px rgba(0,0,0,.24);
      }

      .utility-header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 22px 24px;
        border-bottom: 1px solid var(--divider-color);
        background: color-mix(in srgb, var(--card-background-color, var(--ha-card-background)) 96%, transparent);
        backdrop-filter: blur(10px);
      }

      .utility-header h2,
      .utility-header p {
        margin: 0;
      }

      .utility-header h2 {
        font-size: 21px;
      }

      .utility-header p {
        margin-top: 5px;
        color: var(--secondary-text-color);
        font-size: 10px;
        line-height: 1.45;
      }

      .utility-content {
        display: grid;
        gap: 14px;
        padding: 18px 24px 28px;
      }

      .setting-row {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 13px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--secondary-background-color);
      }

      .setting-row.static-setting {
        cursor: default;
      }

      .setting-row.static-setting .btn {
        align-self: center;
      }

      .ignored-conflict-list {
        display: grid;
        gap: 6px;
        margin: -4px 0 12px 54px;
        padding: 8px;
        border-left: 2px solid color-mix(in srgb, var(--secondary-text-color) 18%, transparent);
      }

      .ignored-conflict-list-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 7px 9px;
        border: 1px solid var(--divider-color);
        border-radius: 11px;
        background: var(--secondary-background-color);
      }

      .ignored-conflict-list-icon {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--secondary-text-color) 7%, transparent);
      }

      .ignored-conflict-list-icon ha-icon { --mdc-icon-size: 16px; }
      .ignored-conflict-list-copy { min-width: 0; }
      .ignored-conflict-list-copy strong,
      .ignored-conflict-list-copy small { display: block; }
      .ignored-conflict-list-copy strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
      }
      .ignored-conflict-list-copy small {
        margin-top: 3px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--secondary-text-color);
        font-size: 8px;
      }

      .setting-row.nested {
        margin-left: 22px;
      }

      .disabled-setting {
        opacity: .55;
      }

      .setting-icon {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--primary-color) 9%, transparent);
        color: var(--primary-color);
      }

      .setting-icon.warning {
        color: var(--warning-color, #f9a825);
        background: color-mix(in srgb, var(--warning-color, #f9a825) 9%, transparent);
      }

      .setting-icon.muted {
        color: var(--secondary-text-color);
      }

      .setting-copy {
        min-width: 0;
      }

      .setting-copy strong,
      .setting-copy small,
      .setting-copy em {
        display: block;
      }

      .setting-copy strong {
        font-size: 12px;
      }

      .setting-copy small {
        margin-top: 4px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.45;
      }

      .setting-copy em {
        margin-top: 5px;
        color: var(--primary-color);
        font-size: 9px;
        font-style: normal;
        font-weight: 750;
      }

      .settings-explanation,
      .import-safety {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        padding: 11px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        background: color-mix(in srgb, var(--primary-color) 5%, var(--secondary-background-color));
      }

      .settings-explanation ha-icon,
      .import-safety ha-icon {
        color: var(--primary-color);
        --mdc-icon-size: 17px;
      }

      .settings-explanation strong,
      .settings-explanation span {
        display: block;
      }

      .settings-explanation strong {
        font-size: 10px;
      }

      .settings-explanation span,
      .import-safety span {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.45;
      }

      .backup-section {
        display: grid;
        grid-template-columns: 46px minmax(0, 1fr);
        gap: 13px;
        padding: 14px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--secondary-background-color);
      }

      .backup-section-icon {
        display: grid;
        place-items: center;
        width: 42px;
        height: 42px;
        border-radius: 13px;
        color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 10%, transparent);
      }

      .backup-section-copy h3,
      .backup-section-copy p {
        margin: 0;
      }

      .backup-section-copy h3 {
        font-size: 12px;
      }

      .backup-section-copy p {
        margin: 4px 0 10px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.45;
      }

      .hidden-file {
        display: none;
      }

      .selected-file {
        margin-top: 8px;
        color: var(--secondary-text-color);
        font-size: 9px;
        overflow-wrap: anywhere;
      }

      .utility-message {
        padding: 10px 11px;
        border-radius: 11px;
        font-size: 10px;
        line-height: 1.4;
      }

      .error-message {
        color: var(--aem-danger);
        border: 1px solid color-mix(in srgb, var(--aem-danger) 30%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-danger) 7%, transparent);
      }

      .success-message {
        color: var(--aem-success);
        border: 1px solid color-mix(in srgb, var(--aem-success) 30%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-success) 7%, transparent);
      }

      .import-preview {
        padding: 14px;
        border: 1px solid color-mix(in srgb, var(--primary-color) 28%, var(--divider-color));
        border-radius: 14px;
        background: color-mix(in srgb, var(--primary-color) 5%, var(--secondary-background-color));
      }

      .import-preview-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .import-preview-head ha-icon {
        color: var(--primary-color);
      }

      .import-preview-head h3,
      .import-preview-head p {
        margin: 0;
      }

      .import-preview-head h3 {
        font-size: 12px;
      }

      .import-preview-head p {
        margin-top: 2px;
        color: var(--secondary-text-color);
        font-size: 9px;
      }

      .preview-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 7px;
        margin-top: 12px;
      }

      .preview-metrics div {
        padding: 9px;
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        background: var(--card-background-color, var(--ha-card-background));
      }

      .preview-metrics strong,
      .preview-metrics span {
        display: block;
      }

      .preview-metrics strong {
        font-size: 16px;
      }

      .preview-metrics span {
        margin-top: 2px;
        color: var(--secondary-text-color);
        font-size: 8px;
      }

      .import-note {
        margin-top: 10px;
        color: var(--warning-color, #f9a825);
        font-size: 9px;
        line-height: 1.4;
      }

      .import-safety {
        margin-top: 10px;
      }

      .import-preview > .btn {
        margin-top: 12px;
      }

      .conflict-view {
        padding: 18px 28px 26px;
      }

      .conflict-view-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 3px 0 15px;
      }

      .conflict-view-kicker {
        color: var(--aem-danger);
        font-size: 9px;
        font-weight: 850;
        letter-spacing: .1em;
      }

      .conflict-view-head h2,
      .conflict-view-head p {
        margin: 0;
      }

      .conflict-view-head h2 {
        margin-top: 3px;
        font-size: 21px;
      }

      .conflict-view-head p {
        margin-top: 5px;
        max-width: 700px;
        color: var(--secondary-text-color);
        font-size: 10px;
        line-height: 1.45;
      }

      .conflict-summary-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 13px 14px;
        border: 1px solid color-mix(in srgb, var(--aem-danger) 30%, var(--divider-color));
        border-radius: 14px;
        background: color-mix(in srgb, var(--aem-danger) 7%, var(--secondary-background-color));
      }

      .conflict-summary-card > ha-icon {
        color: var(--aem-danger);
      }

      .conflict-summary-card strong,
      .conflict-summary-card span {
        display: block;
      }

      .conflict-summary-card strong {
        font-size: 13px;
      }

      .conflict-summary-card span {
        margin-top: 2px;
        color: var(--secondary-text-color);
        font-size: 9px;
      }

      .conflict-groups {
        display: grid;
        gap: 10px;
        margin-top: 12px;
      }

      .conflict-group-card {
        overflow: hidden;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--secondary-background-color);
      }

      .conflict-group-name {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 13px;
        border-bottom: 1px solid var(--divider-color);
      }

      .conflict-group-name > ha-icon {
        color: var(--aem-danger);
      }

      .conflict-group-name small,
      .conflict-group-name strong {
        display: block;
      }

      .conflict-group-name small {
        color: var(--secondary-text-color);
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: .06em;
      }

      .conflict-group-name strong {
        margin-top: 2px;
        font-size: 13px;
      }

      .conflict-assistants {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        margin-top: 5px;
      }

      .conflict-assistants > span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 6px;
        border-radius: 999px;
        color: var(--aem-danger);
        background: color-mix(in srgb, var(--aem-danger) 8%, transparent);
        font-size: 8px;
        font-weight: 750;
      }

      .conflict-assistants ha-icon {
        --mdc-icon-size: 12px;
      }

      .conflict-loading {
        display: flex;
        align-items: center;
        gap: 9px;
        margin: 18px 28px;
        padding: 14px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        color: var(--secondary-text-color);
        background: var(--secondary-background-color);
        font-size: 10px;
      }

      .conflict-group-entities {
        display: grid;
      }

      .conflict-overview-entry {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: stretch;
        border-bottom: 1px solid var(--divider-color);
      }

      .conflict-overview-entry:last-child {
        border-bottom: 0;
      }

      .conflict-overview-entry .conflict-overview-entity {
        border-bottom: 0;
      }

      .ignore-conflict-entity {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        margin: 7px 9px 7px 0;
        padding: 0 9px;
        border: 1px solid var(--divider-color);
        border-radius: 9px;
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        cursor: pointer;
        font: inherit;
        font-size: 9px;
        font-weight: 700;
      }

      .ignore-conflict-entity:hover {
        color: var(--primary-text-color);
        border-color: color-mix(in srgb, var(--primary-color) 30%, var(--divider-color));
      }

      .ignore-conflict-entity ha-icon {
        --mdc-icon-size: 14px;
      }

      .conflict-overview-entity,
      .ambiguous-entity {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 13px;
        border: 0;
        border-bottom: 1px solid var(--divider-color);
        background: transparent;
        color: var(--primary-text-color);
        text-align: left;
        cursor: pointer;
        font: inherit;
      }

      .conflict-overview-entity:last-child,
      .ambiguous-entity:last-child {
        border-bottom: 0;
      }

      .conflict-overview-entity:hover,
      .ambiguous-entity:hover {
        background: color-mix(in srgb, var(--primary-color) 5%, transparent);
      }

      .conflict-overview-entity strong,
      .conflict-overview-entity small,
      .ambiguous-entity strong,
      .ambiguous-entity small {
        display: block;
      }

      .conflict-overview-entity strong,
      .ambiguous-entity strong {
        font-size: 11px;
      }

      .conflict-overview-entity small,
      .ambiguous-entity small {
        margin-top: 2px;
        color: var(--secondary-text-color);
        font-size: 8px;
      }

      .conflict-source-badges {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .conflict-source-badges span {
        padding: 4px 6px;
        border-radius: 999px;
        color: var(--aem-danger);
        background: color-mix(in srgb, var(--aem-danger) 8%, transparent);
        font-size: 8px;
        font-weight: 750;
      }

      .ambiguous-overview {
        margin-top: 18px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--warning-color, #f9a825) 28%, var(--divider-color));
        border-radius: 14px;
        background: var(--secondary-background-color);
      }

      .ambiguous-overview-head {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        padding: 12px 13px;
        border-bottom: 1px solid var(--divider-color);
      }

      .ambiguous-overview-head > ha-icon {
        color: var(--warning-color, #f9a825);
      }

      .ambiguous-overview-head h3,
      .ambiguous-overview-head p {
        margin: 0;
      }

      .ambiguous-overview-head h3 {
        font-size: 12px;
      }

      .ambiguous-overview-head p {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 9px;
      }

      .ambiguous-overview-head > span {
        display: grid;
        place-items: center;
        min-width: 30px;
        height: 26px;
        padding: 0 7px;
        border-radius: 999px;
        color: var(--warning-color, #f9a825);
        background: color-mix(in srgb, var(--warning-color, #f9a825) 9%, transparent);
        font-size: 10px;
        font-weight: 800;
      }

      .ambiguous-reason {
        max-width: 300px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.35;
      }

      .icon-btn {
        display: grid;
        place-items: center;
        width: 46px;
        height: 46px;
        border-radius: 14px;
        border: 1px solid var(--divider-color);
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
        cursor: pointer;
        transition: transform .15s ease, border-color .15s ease, background .15s ease;
      }

      .icon-btn:hover {
        transform: translateY(-1px);
        border-color: color-mix(in srgb, var(--primary-color) 55%, var(--divider-color));
        background: color-mix(in srgb, var(--primary-color) 7%, var(--secondary-background-color));
      }

      .error {
        margin: 18px 28px 0;
        padding: 12px 14px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--aem-danger) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--aem-danger) 40%, transparent);
      }

      .action-notice {
        display: flex;
        align-items: center;
        gap: 9px;
        margin: 14px 28px 0;
        padding: 11px 13px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--primary-color) 24%, var(--divider-color));
        background: color-mix(in srgb, var(--primary-color) 7%, var(--secondary-background-color));
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .action-notice ha-icon {
        color: var(--primary-color);
        --mdc-icon-size: 17px;
      }

      .loading {
        display: flex;
        gap: 10px;
        align-items: center;
        padding: 32px 28px;
        color: var(--secondary-text-color);
      }

      .spinner {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid var(--divider-color);
        border-top-color: var(--primary-color);
        animation: spin .8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .status-tabs {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 12px;
        padding: 18px 28px 0;
      }

      .status-tab {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        min-height: 68px;
        padding: 12px 14px;
        text-align: left;
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 16px;
        cursor: pointer;
        transition: transform .14s ease, border-color .14s ease, background .14s ease;
      }

      .status-tab:hover {
        transform: translateY(-1px);
      }

      .status-tab.active {
        border-color: color-mix(in srgb, var(--primary-color) 60%, var(--divider-color));
        background: color-mix(in srgb, var(--primary-color) 8%, var(--secondary-background-color));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 16%, transparent);
      }

      .status-tab.exposed.active {
        border-color: color-mix(in srgb, var(--aem-success) 60%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-success) 9%, var(--secondary-background-color));
      }

      .status-tab.not-exposed.active {
        border-color: color-mix(in srgb, var(--secondary-text-color) 45%, var(--divider-color));
        background: color-mix(in srgb, var(--secondary-text-color) 7%, var(--secondary-background-color));
      }

      .tab-icon {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 42px;
        height: 42px;
        border-radius: 13px;
        background: color-mix(in srgb, var(--primary-color) 10%, transparent);
        color: var(--primary-color);
      }

      .tab-icon.on {
        color: var(--aem-success);
        background: color-mix(in srgb, var(--aem-success) 12%, transparent);
      }

      .tab-icon.off {
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--secondary-text-color) 10%, transparent);
      }

      .tab-copy {
        min-width: 0;
      }

      .tab-copy strong,
      .tab-copy small {
        display: block;
      }

      .tab-copy strong {
        font-size: 14px;
      }

      .tab-copy small {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 11px;
      }

      .active-assistants,
      .no-assistants-note {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 14px 28px 0;
        flex-wrap: wrap;
      }

      .active-assistants-label {
        color: var(--secondary-text-color);
        font-size: 10px;
        font-weight: 700;
        margin-right: 2px;
      }

      .active-assistant-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 8px;
        border: 1px solid var(--divider-color);
        border-radius: 999px;
        background: var(--secondary-background-color);
        font-size: 10px;
        font-weight: 700;
      }

      .active-assistant-chip ha-icon {
        color: var(--primary-color);
        --mdc-icon-size: 15px;
      }

      .active-assistant-chip strong {
        display: grid;
        place-items: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border-radius: 999px;
        color: var(--aem-success);
        background: color-mix(in srgb, var(--aem-success) 10%, transparent);
        font-size: 9px;
      }

      .no-assistants-note {
        padding: 11px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 13px;
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        font-size: 10px;
        line-height: 1.4;
      }

      .no-assistants-note ha-icon {
        --mdc-icon-size: 18px;
      }

      .active-quality-filters {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 9px 0 0;
        flex-wrap: wrap;
      }

      .active-quality-label {
        color: var(--secondary-text-color);
        font-size: 10px;
        font-weight: 650;
      }

      .active-quality-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 30px;
        padding: 0 8px;
        border: 1px solid color-mix(in srgb, var(--warning-color, #f9a825) 34%, var(--divider-color));
        border-radius: 999px;
        background: color-mix(in srgb, var(--warning-color, #f9a825) 8%, var(--secondary-background-color));
        color: var(--primary-text-color);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        font-weight: 750;
      }

      .active-quality-chip > ha-icon:first-child {
        color: var(--warning-color, #f9a825);
        --mdc-icon-size: 15px;
      }

      .active-quality-close {
        color: var(--secondary-text-color);
        --mdc-icon-size: 14px;
      }

      .active-quality-chip:hover {
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 55%, var(--divider-color));
      }

      .active-quality-chip.external {
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 34%, var(--divider-color));
        background: color-mix(in srgb, var(--warning-color, #f9a825) 8%, var(--secondary-background-color));
      }

      .external-change-history {
        display: grid;
        gap: 6px;
        margin-top: 10px;
        padding: 8px;
        border: 1px solid color-mix(in srgb, var(--warning-color, #f9a825) 26%, var(--divider-color));
        border-radius: 13px;
        background: color-mix(in srgb, var(--warning-color, #f9a825) 4%, var(--secondary-background-color));
      }

      .external-change-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        min-height: 44px;
        padding: 7px 8px;
        border-radius: 10px;
        background: var(--card-background-color, var(--ha-card-background));
      }

      .external-change-item > ha-icon {
        color: var(--warning-color, #f9a825);
        --mdc-icon-size: 18px;
      }

      .external-change-item.missing > ha-icon {
        color: var(--aem-danger);
      }

      .external-change-copy { min-width: 0; }
      .external-change-copy strong,
      .external-change-copy small { display: block; }
      .external-change-copy strong { font-size: 10px; }
      .external-change-copy small {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.35;
      }

      .external-change-open {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 9px;
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        cursor: pointer;
      }

      .external-change-missing-label {
        color: var(--aem-danger);
        font-size: 9px;
        font-weight: 750;
      }

      .filters-panel {
        margin: 16px 28px 0;
        padding: 12px;
        border: 1px solid var(--divider-color);
        border-radius: 17px;
        background: color-mix(in srgb, var(--secondary-background-color) 80%, transparent);
      }

      .search-wrap {
        position: relative;
        display: block;
      }

      .search-icon {
        position: absolute;
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--secondary-text-color);
        pointer-events: none;
        --mdc-icon-size: 21px;
      }

      input[type="search"],
      select {
        width: 100%;
        height: 44px;
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        background: var(--card-background-color, var(--ha-card-background));
        color: var(--primary-text-color);
        outline: none;
        padding: 0 12px;
        font: inherit;
      }

      input[type="search"] {
        padding-left: 43px;
        font-size: 14px;
      }

      input[type="search"]:focus,
      select:focus {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 12%, transparent);
      }

      .filter-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 9px;
        margin-top: 9px;
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 14px 28px;
      }

      .results-info {
        flex: 0 0 auto;
        color: var(--secondary-text-color);
        font-size: 12px;
      }

      .results-info strong {
        color: var(--primary-text-color);
        font-size: 14px;
      }

      .selection-count {
        color: var(--primary-color);
        font-weight: 750;
      }

      .action-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }

      .bulk-assistant {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 40px;
        padding: 0 9px 0 11px;
        border: 1px solid var(--divider-color);
        border-radius: 11px;
        background: var(--secondary-background-color);
      }

      .bulk-assistant > span {
        color: var(--secondary-text-color);
        font-size: 9px;
        font-weight: 700;
        white-space: nowrap;
      }

      .bulk-assistant select {
        width: auto;
        min-width: 110px;
        height: 30px;
        padding: 0 7px;
        border-radius: 8px;
        font-size: 10px;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 40px;
        border-radius: 11px;
        border: 1px solid transparent;
        padding: 0 13px;
        font: inherit;
        font-size: 12px;
        font-weight: 750;
        cursor: pointer;
        transition: transform .14s ease, filter .14s ease, background .14s ease;
      }

      .btn ha-icon {
        --mdc-icon-size: 17px;
      }

      .btn:hover:not(:disabled) {
        transform: translateY(-1px);
      }

      .btn:disabled {
        opacity: .4;
        cursor: not-allowed;
      }

      .primary {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
        box-shadow: 0 5px 14px color-mix(in srgb, var(--primary-color) 18%, transparent);
      }

      .primary-soft {
        background: color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color));
        border-color: color-mix(in srgb, var(--primary-color) 28%, var(--divider-color));
        color: var(--primary-color);
      }

      .danger {
        background: color-mix(in srgb, var(--aem-danger) 9%, transparent);
        border-color: color-mix(in srgb, var(--aem-danger) 27%, transparent);
        color: var(--aem-danger);
      }

      .secondary {
        background: var(--secondary-background-color);
        border-color: var(--divider-color);
        color: var(--primary-text-color);
      }

      .ghost {
        background: transparent;
        color: var(--secondary-text-color);
      }

      .list-shell {
        margin: 0 28px;
        border: 1px solid var(--divider-color);
        border-radius: 17px;
        overflow: hidden;
        background: color-mix(in srgb, var(--card-background-color) 97%, transparent);
      }

      .table-head,
      .entity-row {
        display: grid;
        grid-template-columns: 48px minmax(300px, 1.45fr) minmax(220px, .8fr) minmax(340px, 1.15fr);
        align-items: center;
      }

      .table-head {
        min-height: 42px;
        padding: 0 16px;
        border-bottom: 1px solid var(--divider-color);
        background: color-mix(in srgb, var(--secondary-background-color) 82%, transparent);
        color: var(--secondary-text-color);
        font-size: 10px;
        font-weight: 850;
        text-transform: uppercase;
        letter-spacing: .075em;
      }

      .entity-list {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .entity-row {
        position: relative;
        min-height: 82px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--divider-color);
        transition: background .14s ease;
      }

      .entity-row:last-child {
        border-bottom: 0;
      }

      .entity-row:before {
        content: "";
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 3px;
        border-radius: 0 4px 4px 0;
        background: transparent;
      }

      .entity-row.assist-enabled {
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--aem-success) 6%, transparent),
          transparent 35%
        );
      }

      .entity-row.assist-enabled:before {
        background: var(--aem-success);
      }

      .entity-row:hover {
        background-color: color-mix(in srgb, var(--primary-color) 5%, transparent);
      }

      .entity-row.is-hidden {
        opacity: .72;
      }

      .select-cell {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .row-select {
        width: 18px;
        height: 18px;
        accent-color: var(--primary-color);
        cursor: pointer;
      }

      .entity-main {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        padding-right: 16px;
      }

      .entity-icon {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 42px;
        height: 42px;
        border-radius: 13px;
        color: var(--secondary-text-color);
        background: var(--secondary-background-color);
        border: 1px solid var(--divider-color);
      }

      .entity-icon.enabled {
        color: var(--aem-success);
        background: color-mix(in srgb, var(--aem-success) 10%, var(--secondary-background-color));
        border-color: color-mix(in srgb, var(--aem-success) 25%, var(--divider-color));
      }

      .entity-icon ha-icon {
        --mdc-icon-size: 22px;
      }

      .entity-text {
        min-width: 0;
      }

      .name-line {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
      }

      .entity-name {
        font-size: 14px;
        font-weight: 780;
        line-height: 1.25;
      }

      .entity-id {
        margin-top: 5px;
        color: var(--secondary-text-color);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .domain-chip,
      .category-chip {
        border-radius: 999px;
        padding: 4px 7px;
        font-size: 9px;
        line-height: 1;
        font-weight: 780;
      }

      .domain-chip {
        background: color-mix(in srgb, var(--primary-color) 10%, transparent);
        color: var(--primary-color);
      }

      .category-chip {
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        border: 1px solid var(--divider-color);
      }

      .device-class-chip {
        border-radius: 999px;
        padding: 4px 7px;
        font-size: 9px;
        line-height: 1;
        font-weight: 780;
        background: color-mix(in srgb, var(--aem-success) 8%, var(--secondary-background-color));
        color: var(--aem-success);
        border: 1px solid color-mix(in srgb, var(--aem-success) 20%, var(--divider-color));
      }

      .spoken-name-chip {
        color: var(--aem-success);
        background: color-mix(in srgb, var(--aem-success) 8%, var(--secondary-background-color));
        border-color: color-mix(in srgb, var(--aem-success) 22%, var(--divider-color));
      }

      .spoken-name-off-chip {
        color: var(--secondary-text-color);
        background: var(--secondary-background-color);
      }

      .ignored-conflict-chip {
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--secondary-text-color) 7%, var(--secondary-background-color));
        border-style: dashed;
      }

      .location-cell {
        min-width: 0;
        padding-right: 18px;
      }

      .location-line {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        color: var(--primary-text-color);
        font-size: 12px;
        font-weight: 650;
      }

      .location-line ha-icon {
        flex: 0 0 auto;
        color: var(--secondary-text-color);
        --mdc-icon-size: 16px;
      }

      .location-line span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .secondary-location {
        margin-top: 6px;
        color: var(--secondary-text-color);
        font-size: 11px;
        font-weight: 500;
      }

      .assistant-switches {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 142px;
        justify-content: end;
        gap: 8px;
      }

      .assistant-mini {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        width: 142px;
        min-height: 32px;
        padding: 4px 6px 4px 8px;
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        background: var(--secondary-background-color);
        cursor: default;
      }

      .assistant-mini.on {
        border-color: color-mix(in srgb, var(--aem-success) 26%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-success) 7%, var(--secondary-background-color));
      }

      .assistant-mini-label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        flex: 1 1 auto;
        color: var(--secondary-text-color);
        font-size: 9px;
        font-weight: 750;
      }

      .assistant-mini.on .assistant-mini-label {
        color: var(--primary-text-color);
      }

      .assistant-mini-label ha-icon {
        --mdc-icon-size: 14px;
      }

      .assistant-custom-icon {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
      }

      .assistant-custom-icon-alexa {
        color: #4FC3F7;
        font-size: 13px;
        font-weight: 800;
        line-height: 1;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-transform: lowercase;
      }

      .assistant-custom-icon-google {
        width: 16px;
        height: 16px;
      }

      .ga-dot {
        position: absolute;
        display: block;
        border-radius: 999px;
      }

      .ga-dot-lg {
        left: 1px;
        top: 4px;
        width: 8px;
        height: 8px;
        background: #29B6F6;
      }

      .ga-dot-sm {
        width: 5px;
        height: 5px;
        right: 1px;
      }

      .ga-dot-top {
        top: 1px;
        background: #42A5F5;
      }

      .ga-dot-bottom {
        bottom: 1px;
        background: #26C6DA;
      }

      .assistant-mini-label > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mini-switch {
        position: relative;
        display: block;
        width: 32px;
        height: 18px;
      }

      .mini-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .mini-slider {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--disabled-text-color) 70%, var(--secondary-background-color));
        cursor: pointer;
        transition: .16s ease;
      }

      .mini-slider:before {
        content: "";
        position: absolute;
        width: 14px;
        height: 14px;
        left: 2px;
        top: 2px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 3px rgba(0,0,0,.28);
        transition: .16s ease;
      }

      .mini-switch input:checked + .mini-slider {
        background: var(--aem-success);
      }

      .mini-switch input:checked + .mini-slider:before {
        transform: translateX(14px);
      }

      .mini-switch input:disabled + .mini-slider {
        opacity: .42;
        cursor: not-allowed;
      }

      .mini-unsupported-icon {
        display: inline-grid;
        place-items: center;
        margin-left: 3px;
        color: var(--aem-danger);
        cursor: help;
      }

      .mini-unsupported-icon ha-icon {
        --mdc-icon-size: 13px;
      }

      .assistant-mini.unsupported {
        border-color: color-mix(in srgb, var(--aem-danger) 28%, var(--divider-color));
      }

      .assistant-mini.unsupported:not(.on) {
        opacity: .82;
      }

      .mini-unsupported {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-left: 4px;
        color: var(--aem-danger);
        font-size: 8px;
        font-weight: 750;
      }

      .mini-unsupported ha-icon {
        --mdc-icon-size: 11px;
      }

      .assistant-count {
        display: block;
        min-width: 110px;
        color: var(--secondary-text-color);
        text-align: right;
        font-size: 8px;
      }

      .assist-cell {
        display: grid;
        justify-content: end;
        align-content: center;
        justify-items: end;
        gap: 7px;
        min-width: 0;
      }

      .status-wrap {
        min-width: 0;
        text-align: right;
      }

      .status {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 5px;
        border-radius: 999px;
        padding: 6px 9px;
        font-size: 10px;
        font-weight: 850;
        white-space: nowrap;
      }

      .status ha-icon {
        --mdc-icon-size: 14px;
      }

      .status-on {
        color: var(--aem-success);
        background: color-mix(in srgb, var(--aem-success) 11%, transparent);
      }

      .status-off {
        color: var(--aem-danger);
        background: color-mix(in srgb, var(--aem-danger) 9%, transparent);
      }

      .status-default {
        color: var(--secondary-text-color);
        background: var(--secondary-background-color);
        border: 1px solid var(--divider-color);
      }

      .status-detail {
        display: block;
        margin-top: 5px;
        color: var(--secondary-text-color);
        font-size: 9px;
        white-space: nowrap;
      }

      .switch {
        position: relative;
        width: 48px;
        height: 28px;
        flex: 0 0 auto;
      }

      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--disabled-text-color) 70%, var(--secondary-background-color));
        cursor: pointer;
        transition: .18s ease;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--divider-color) 80%, transparent);
      }

      .slider:before {
        content: "";
        position: absolute;
        width: 22px;
        height: 22px;
        left: 3px;
        top: 3px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 2px 5px rgba(0,0,0,.28);
        transition: .18s ease;
      }

      .switch input:checked + .slider {
        background: var(--aem-success);
      }

      .switch input:checked + .slider:before {
        transform: translateX(20px);
      }

      .empty {
        display: grid;
        justify-items: center;
        gap: 6px;
        padding: 45px 20px;
        color: var(--secondary-text-color);
        text-align: center;
      }

      .empty ha-icon {
        --mdc-icon-size: 30px;
      }

      .empty strong {
        color: var(--primary-text-color);
        font-size: 14px;
      }

      .empty span {
        font-size: 11px;
      }

      .footer-inline-icon {
        vertical-align: -3px;
        margin-right: 3px;
        --mdc-icon-size: 14px;
      }

      .footer-note {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
        padding: 13px 28px 20px;
        color: var(--secondary-text-color);
        font-size: 10px;
        line-height: 1.45;
      }


      .exclude-filter {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-top: 10px;
        flex-wrap: wrap;
      }

      .exclude-dropdown {
        position: relative;
        flex: 0 0 auto;
      }

      .exclude-dropdown > summary {
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 40px;
        padding: 0 11px;
        border: 1px solid var(--divider-color);
        border-radius: 11px;
        background: var(--card-background-color, var(--ha-card-background));
        color: var(--primary-text-color);
        cursor: pointer;
        list-style: none;
        user-select: none;
        font-size: 12px;
        font-weight: 700;
      }

      .exclude-dropdown > summary::-webkit-details-marker {
        display: none;
      }

      .exclude-dropdown[open] > summary {
        border-color: color-mix(in srgb, var(--primary-color) 55%, var(--divider-color));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 10%, transparent);
      }

      .exclude-summary-main {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }

      .exclude-summary-main ha-icon {
        color: var(--secondary-text-color);
        --mdc-icon-size: 17px;
      }

      .exclude-summary-count {
        display: grid;
        place-items: center;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color));
        color: var(--primary-color);
        font-size: 10px;
        font-weight: 850;
      }

      .exclude-chevron {
        color: var(--secondary-text-color);
        --mdc-icon-size: 17px;
        transition: transform .15s ease;
      }

      .exclude-dropdown[open] .exclude-chevron {
        transform: rotate(180deg);
      }

      .exclude-menu {
        position: absolute;
        z-index: 40;
        top: calc(100% + 7px);
        left: 0;
        width: min(390px, calc(100vw - 64px));
        max-height: min(460px, 60vh);
        overflow: hidden;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--card-background-color, var(--ha-card-background));
        box-shadow: 0 14px 34px rgba(0, 0, 0, .22);
      }

      .exclude-menu-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 13px;
        border-bottom: 1px solid var(--divider-color);
      }

      .exclude-menu-head strong,
      .exclude-menu-head small {
        display: block;
      }

      .exclude-menu-head strong {
        font-size: 12px;
      }

      .exclude-menu-head small {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.35;
      }

      .clear-exclusions {
        flex: 0 0 auto;
        border: 0;
        background: transparent;
        color: var(--primary-color);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        font-weight: 750;
        padding: 3px 0;
      }

      .exclude-options {
        max-height: 360px;
        overflow-y: auto;
        padding: 6px;
      }

      .exclude-option {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 9px;
        padding: 8px 9px;
        border-radius: 10px;
        cursor: pointer;
      }

      .exclude-option:hover {
        background: var(--secondary-background-color);
      }

      .exclude-option input {
        width: 17px;
        height: 17px;
        accent-color: var(--primary-color);
      }

      .exclude-option-copy {
        min-width: 0;
      }

      .exclude-option-copy strong,
      .exclude-option-copy small {
        display: block;
      }

      .exclude-option-copy strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 750;
      }

      .exclude-option-copy small {
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--secondary-text-color);
        font-size: 9px;
      }

      .exclude-empty {
        padding: 18px 12px;
        color: var(--secondary-text-color);
        text-align: center;
        font-size: 10px;
      }

      .exclude-chips {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1 1 300px;
        min-width: 0;
        flex-wrap: wrap;
      }

      .exclude-chips-label {
        color: var(--secondary-text-color);
        font-size: 10px;
        font-weight: 650;
      }

      .exclude-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 30px;
        padding: 0 8px 0 10px;
        border: 1px solid color-mix(in srgb, var(--aem-danger) 24%, var(--divider-color));
        border-radius: 999px;
        background: color-mix(in srgb, var(--aem-danger) 7%, var(--secondary-background-color));
        color: var(--primary-text-color);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        font-weight: 700;
      }

      .exclude-chip:hover {
        border-color: color-mix(in srgb, var(--aem-danger) 45%, var(--divider-color));
      }

      .exclude-chip ha-icon {
        color: var(--aem-danger);
        --mdc-icon-size: 14px;
      }

      .entity-list.group-mode {
        background: color-mix(in srgb, var(--secondary-background-color) 35%, transparent);
      }

      .device-group {
        border-bottom: 1px solid var(--divider-color);
        background: var(--card-background-color, var(--ha-card-background));
      }

      .device-group:last-child {
        border-bottom: 0;
      }

      .device-group-header {
        display: grid;
        grid-template-columns: 28px 44px minmax(220px, 1.4fr) minmax(120px, .8fr) minmax(130px, auto);
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 68px;
        padding: 10px 16px;
        border: 0;
        background: transparent;
        color: var(--primary-text-color);
        text-align: left;
        cursor: pointer;
        font: inherit;
      }

      .device-group-header:hover {
        background: color-mix(in srgb, var(--primary-color) 5%, transparent);
      }

      .device-group.expanded .device-group-header {
        background: color-mix(in srgb, var(--primary-color) 6%, var(--secondary-background-color));
        border-bottom: 1px solid var(--divider-color);
      }

      .device-group-chevron {
        display: grid;
        place-items: center;
        color: var(--secondary-text-color);
      }

      .device-group-chevron ha-icon {
        --mdc-icon-size: 19px;
      }

      .device-group-icon {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 12px;
        color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 9%, var(--secondary-background-color));
        border: 1px solid color-mix(in srgb, var(--primary-color) 18%, var(--divider-color));
      }

      .device-group-icon ha-icon {
        --mdc-icon-size: 21px;
      }

      .device-group-copy {
        min-width: 0;
      }

      .device-group-copy strong,
      .device-group-copy small {
        display: block;
      }

      .device-group-copy strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 800;
      }

      .device-group-copy small {
        margin-top: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .device-group-platforms {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }

      .group-platform-chip {
        padding: 4px 7px;
        border-radius: 999px;
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        border: 1px solid var(--divider-color);
        font-size: 9px;
        font-weight: 700;
      }

      .device-group-counts {
        text-align: right;
      }

      .device-group-counts span,
      .device-group-counts strong {
        display: block;
        white-space: nowrap;
      }

      .device-group-counts span {
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .device-group-counts strong {
        margin-top: 4px;
        color: var(--aem-success);
        font-size: 10px;
      }

      .device-group-entities {
        padding-left: 18px;
        background: color-mix(in srgb, var(--secondary-background-color) 30%, transparent);
      }

      .entity-row.grouped-row {
        background-color: var(--card-background-color, var(--ha-card-background));
      }

      .entity-row.grouped-row:first-child {
        border-top: 0;
      }

      .entity-row {
        cursor: pointer;
      }

      .entity-row .switch,
      .entity-row .select-cell {
        cursor: default;
      }

      .pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 14px 28px 4px;
      }

      .pager-info {
        color: var(--secondary-text-color);
        font-size: 11px;
      }

      .pager-info span {
        margin-left: 5px;
      }

      .pager-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .pager-btn {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
        cursor: pointer;
      }

      .pager-btn:disabled {
        opacity: .35;
        cursor: not-allowed;
      }

      .pager-page {
        min-width: 92px;
        text-align: center;
        color: var(--secondary-text-color);
        font-size: 11px;
        font-weight: 700;
      }

      .detail-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        justify-content: flex-end;
        background: rgba(0, 0, 0, .38);
        backdrop-filter: blur(2px);
      }

      .detail-panel {
        width: min(680px, 94vw);
        height: 100%;
        overflow-y: auto;
        background: var(--card-background-color, var(--ha-card-background));
        color: var(--primary-text-color);
        border-left: 1px solid var(--divider-color);
        box-shadow: -16px 0 44px rgba(0,0,0,.24);
      }

      .detail-header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 22px 24px;
        border-bottom: 1px solid var(--divider-color);
        background: color-mix(in srgb, var(--card-background-color, var(--ha-card-background)) 96%, transparent);
        backdrop-filter: blur(10px);
      }

      .detail-title-wrap {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .detail-icon {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 48px;
        height: 48px;
        border-radius: 15px;
        background: color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color));
        color: var(--primary-color);
        border: 1px solid color-mix(in srgb, var(--primary-color) 22%, var(--divider-color));
      }

      .detail-icon ha-icon {
        --mdc-icon-size: 25px;
      }

      .detail-eyebrow {
        margin-bottom: 3px;
        color: var(--primary-color);
        font-size: 9px;
        font-weight: 850;
        letter-spacing: .1em;
      }

      .detail-header h2 {
        margin: 0;
        font-size: 21px;
        line-height: 1.25;
      }

      .detail-entity-id {
        margin-top: 4px;
        color: var(--secondary-text-color);
        font-size: 11px;
        word-break: break-all;
      }

      .detail-loading,
      .detail-note {
        margin: 16px 24px 0;
        padding: 11px 12px;
        border-radius: 12px;
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
        font-size: 11px;
      }

      .detail-loading {
        display: flex;
        align-items: center;
        gap: 9px;
      }

      .detail-status {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 12px;
        margin: 18px 24px;
        padding: 14px 15px;
        border-radius: 15px;
        border: 1px solid var(--divider-color);
        background: var(--secondary-background-color);
      }

      .detail-status.on {
        border-color: color-mix(in srgb, var(--aem-success) 30%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-success) 7%, var(--secondary-background-color));
      }

      .detail-status > ha-icon {
        color: var(--secondary-text-color);
      }

      .detail-status.on > ha-icon {
        color: var(--aem-success);
      }

      .detail-status strong,
      .detail-status span {
        display: block;
      }

      .detail-status strong {
        font-size: 13px;
      }

      .detail-status span {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .detail-assistant-row.unsupported {
        border-color: color-mix(in srgb, var(--aem-danger) 28%, var(--divider-color));
      }

      .assistant-unsupported-text {
        display: flex !important;
        align-items: center;
        gap: 5px;
        color: var(--aem-danger) !important;
      }

      .assistant-unsupported-text ha-icon {
        --mdc-icon-size: 14px;
      }

      .detail-assistants,
      .alias-editor {
        margin: 18px 24px;
        padding: 14px;
        border: 1px solid var(--divider-color);
        border-radius: 15px;
        background: color-mix(in srgb, var(--secondary-background-color) 72%, transparent);
      }

      .detail-section-title {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .detail-section-title h3 {
        margin: 0;
        font-size: 12px;
      }

      .detail-section-title p {
        margin: 4px 0 0;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.4;
      }

      .detail-assistant-list {
        display: grid;
        gap: 7px;
      }

      .detail-assistant-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 58px;
        padding: 9px 10px;
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        background: var(--card-background-color, var(--ha-card-background));
      }

      .detail-assistant-row.on {
        border-color: color-mix(in srgb, var(--aem-success) 28%, var(--divider-color));
        background: color-mix(in srgb, var(--aem-success) 6%, var(--card-background-color, var(--ha-card-background)));
      }

      .assistant-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .assistant-brand-icon {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        border-radius: 11px;
        background: var(--secondary-background-color);
        color: var(--primary-color);
      }

      .assistant-brand-icon ha-icon {
        --mdc-icon-size: 19px;
      }

      .assistant-brand strong,
      .assistant-brand small {
        display: block;
      }

      .assistant-brand strong {
        font-size: 11px;
      }

      .assistant-brand small {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 9px;
      }

      .inline-note {
        margin: 0;
      }

      .entity-name-alias-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
        padding: 12px;
        border: 1px solid var(--divider-color);
        border-radius: 13px;
        background: color-mix(in srgb, var(--secondary-background-color) 72%, transparent);
      }

      .entity-name-alias-icon {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 11px;
        color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 9%, transparent);
      }

      .entity-name-alias-copy {
        min-width: 0;
      }

      .entity-name-alias-copy strong,
      .entity-name-alias-copy small,
      .entity-name-alias-copy em {
        display: block;
      }

      .entity-name-alias-copy strong {
        font-size: 12px;
      }

      .entity-name-alias-copy small {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 9px;
        line-height: 1.35;
      }

      .entity-name-alias-copy em {
        margin-top: 5px;
        font-size: 9px;
        font-style: normal;
        font-weight: 750;
      }

      .entity-name-alias-copy .spoken-on {
        color: var(--aem-success);
      }

      .entity-name-alias-copy .spoken-off {
        color: var(--secondary-text-color);
      }

      .alias-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }

      .alias-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 30px;
        padding: 0 4px 0 9px;
        border: 1px solid color-mix(in srgb, var(--primary-color) 22%, var(--divider-color));
        border-radius: 999px;
        background: color-mix(in srgb, var(--primary-color) 7%, var(--card-background-color, var(--ha-card-background)));
        font-size: 10px;
        font-weight: 700;
      }

      .alias-chip button {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--secondary-text-color);
        cursor: pointer;
      }

      .alias-chip button:hover {
        background: var(--secondary-background-color);
        color: var(--aem-danger);
      }

      .alias-chip ha-icon {
        --mdc-icon-size: 13px;
      }

      .alias-empty {
        margin-bottom: 10px;
        color: var(--secondary-text-color);
        font-size: 9px;
      }

      .alias-add-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
      }

      .alias-input {
        width: 100%;
        min-width: 0;
        height: 40px;
        padding: 0 11px;
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        outline: none;
        background: var(--card-background-color, var(--ha-card-background));
        color: var(--primary-text-color);
        font: inherit;
        font-size: 11px;
      }

      .alias-input:focus {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 10%, transparent);
      }

      .alias-feedback {
        margin-top: 8px;
        font-size: 9px;
        font-weight: 700;
      }

      .error-text {
        color: var(--aem-danger);
      }

      .success-text {
        color: var(--aem-success);
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        padding: 0 24px;
      }

      .detail-section {
        min-width: 0;
        padding: 14px;
        border: 1px solid var(--divider-color);
        border-radius: 15px;
        background: color-mix(in srgb, var(--secondary-background-color) 72%, transparent);
      }

      .detail-section:last-child {
        grid-column: 1 / -1;
      }

      .detail-section h3 {
        margin: 0 0 9px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: var(--secondary-text-color);
      }

      .detail-item {
        display: grid;
        grid-template-columns: minmax(110px, .8fr) minmax(0, 1.2fr);
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid color-mix(in srgb, var(--divider-color) 65%, transparent);
      }

      .detail-item:last-child {
        border-bottom: 0;
      }

      .detail-item span {
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .detail-item strong {
        min-width: 0;
        text-align: right;
        font-size: 11px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }

      .detail-select-item {
        align-items: center;
        grid-template-columns: minmax(74px, .55fr) minmax(140px, 1.45fr);
        padding: 4px 0;
      }

      .detail-select-item span {
        white-space: nowrap;
      }

      .detail-select-item select {
        min-width: 0;
        width: 100%;
        justify-self: end;
        height: 24px;
        padding: 2px 40px 2px 9px;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font-size: 11px;
        font-weight: 650;
        line-height: 1.2;
        text-align: right;
      }

      .detail-select-item option {
        padding-right: 32px;
      }

      .assignment-feedback {
        grid-column: 1 / -1;
        padding: 7px 0 4px;
        font-size: 11px;
        font-weight: 650;
      }

      .attributes {
        margin: 14px 24px 0;
        border: 1px solid var(--divider-color);
        border-radius: 15px;
        overflow: hidden;
        background: var(--secondary-background-color);
      }

      .attributes summary {
        padding: 13px 14px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 750;
      }

      .attribute-list {
        border-top: 1px solid var(--divider-color);
      }

      .attribute-row {
        display: grid;
        grid-template-columns: minmax(120px, .8fr) minmax(0, 1.2fr);
        gap: 10px;
        padding: 9px 14px;
        border-bottom: 1px solid color-mix(in srgb, var(--divider-color) 60%, transparent);
      }

      .attribute-row:last-child {
        border-bottom: 0;
      }

      .attribute-row span {
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .attribute-row code {
        text-align: right;
        white-space: normal;
        overflow-wrap: anywhere;
        font-size: 10px;
        color: var(--primary-text-color);
      }

      .alias-chip.has-conflict {
        border-color: color-mix(in srgb, var(--warning-color, #f9a825) 45%, var(--divider-color));
        background: color-mix(in srgb, var(--warning-color, #f9a825) 8%, var(--secondary-background-color));
      }

      .alias-warning-icon {
        color: var(--warning-color, #f9a825);
        --mdc-icon-size: 15px;
      }

      .alias-index-note {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .small-spinner {
        width: 14px;
        height: 14px;
      }

      .alias-conflict-box {
        margin-top: 11px;
        padding: 11px;
        border: 1px solid color-mix(in srgb, var(--warning-color, #f9a825) 38%, var(--divider-color));
        border-radius: 12px;
        background: color-mix(in srgb, var(--warning-color, #f9a825) 7%, var(--secondary-background-color));
      }

      .alias-conflict-title {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--warning-color, #f9a825);
        font-size: 11px;
      }

      .alias-conflict-title ha-icon {
        --mdc-icon-size: 17px;
      }

      .alias-conflict-item {
        margin-top: 9px;
        color: var(--secondary-text-color);
        font-size: 10px;
      }

      .alias-conflict-name {
        color: var(--primary-text-color);
        font-weight: 800;
      }

      .alias-conflict-targets {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 6px;
      }

      .conflict-entity-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        border: 1px solid var(--divider-color);
        border-radius: 9px;
        background: var(--card-background-color, var(--ha-card-background));
        color: var(--primary-text-color);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
      }

      .conflict-entity-link small {
        color: var(--secondary-text-color);
        font-size: 8px;
      }

      .conflict-ignore-card {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 11px;
        margin: 14px 24px 0;
        padding: 12px 13px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--secondary-background-color);
      }

      .conflict-ignore-card.ignored {
        border-style: dashed;
        background: color-mix(in srgb, var(--secondary-text-color) 5%, var(--secondary-background-color));
      }

      .conflict-ignore-icon {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        color: var(--secondary-text-color);
        background: color-mix(in srgb, var(--secondary-text-color) 8%, transparent);
      }

      .conflict-ignore-copy strong,
      .conflict-ignore-copy span,
      .conflict-ignore-copy small {
        display: block;
      }

      .conflict-ignore-copy strong {
        font-size: 11px;
      }

      .conflict-ignore-copy span {
        margin-top: 3px;
        font-size: 9px;
        color: var(--secondary-text-color);
      }

      .conflict-ignore-copy small {
        margin-top: 4px;
        font-size: 8px;
        color: var(--secondary-text-color);
        opacity: .85;
      }

      .ha-links {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding: 14px 24px 0;
      }

      .detail-footer {
        padding: 16px 24px 28px;
        color: var(--secondary-text-color);
        font-size: 9px;
      }

      @media (max-width: 1120px) {
        .hero {
          align-items: flex-start;
        }

        .assist-summary {
          min-width: 230px;
        }

        .filter-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .table-head,
        .entity-row {
          grid-template-columns: 44px minmax(240px, 1.25fr) minmax(180px, .75fr) minmax(320px, 1fr);
        }

        .assistant-switches {
          grid-auto-columns: 136px;
        }

        .assistant-mini {
          width: 136px;
        }
      }


      @media (max-width: 720px) {
        .ignored-conflict-list {
          margin-left: 0;
        }

        .external-change-item {
          grid-template-columns: auto minmax(0, 1fr);
        }

        .external-change-open,
        .external-change-missing-label {
          grid-column: 2;
          justify-self: start;
        }

        .entity-name-alias-row,
        .conflict-ignore-card {
          grid-template-columns: auto minmax(0, 1fr) auto;
        }

        .conflict-overview-entry {
          grid-template-columns: 1fr;
        }

        .ignore-conflict-entity {
          margin: 0 10px 9px;
          min-height: 34px;
        }

        .exclude-filter {
          flex-direction: column;
        }

        .exclude-dropdown,
        .exclude-dropdown > summary {
          width: 100%;
        }

        .exclude-menu {
          position: static;
          width: 100%;
          margin-top: 7px;
          box-shadow: none;
        }

        .exclude-chips {
          width: 100%;
        }

        .active-assistants,
        .no-assistants-note {
          margin-left: 16px;
          margin-right: 16px;
        }

        .bulk-assistant {
          width: 100%;
          justify-content: space-between;
        }

        .bulk-assistant select {
          flex: 1;
          width: 100%;
        }

        .assistant-mini-label span {
          display: none;
        }

        .assistant-mini {
          padding-left: 6px;
        }

        .detail-assistants,
        .alias-editor {
          margin-left: 16px;
          margin-right: 16px;
        }

        .alias-add-row {
          grid-template-columns: 1fr;
        }

        .pager {
          align-items: flex-start;
          flex-direction: column;
          padding-left: 16px;
          padding-right: 16px;
        }

        .pager-controls {
          width: 100%;
          justify-content: space-between;
        }

        .detail-panel {
          width: 100%;
        }

        .detail-header {
          padding: 16px;
        }

        .detail-status {
          margin-left: 16px;
          margin-right: 16px;
        }

        .detail-grid {
          grid-template-columns: 1fr;
          padding-left: 16px;
          padding-right: 16px;
        }

        .detail-section:last-child {
          grid-column: auto;
        }

        .attributes {
          margin-left: 16px;
          margin-right: 16px;
        }

        .detail-footer {
          padding-left: 16px;
          padding-right: 16px;
        }
      }

      @media (max-width: 900px) {
        .device-group-header {
          grid-template-columns: 24px 38px minmax(0, 1fr) auto;
          grid-template-areas:
            "chevron icon copy counts"
            "chevron icon platforms counts";
          gap: 4px 8px;
        }

        .device-group-chevron { grid-area: chevron; }
        .device-group-icon { grid-area: icon; width: 36px; height: 36px; }
        .device-group-copy { grid-area: copy; }
        .device-group-platforms { grid-area: platforms; }
        .device-group-counts { grid-area: counts; }
      }

      @media (max-width: 820px) {
        .hero-actions {
          flex-wrap: wrap;
        }

        .hero-tool-btn span {
          display: none;
        }

        .hero-tool-btn {
          width: 46px;
          justify-content: center;
          padding: 0;
        }

        .quality-strip,
        .conflict-view {
          margin-left: 0;
          margin-right: 0;
        }

        .quality-strip {
          padding-left: 16px;
          padding-right: 16px;
        }

        .utility-panel {
          width: 100%;
        }

        .setting-row {
          grid-template-columns: 38px minmax(0, 1fr) auto;
        }

        .setting-row.nested {
          margin-left: 0;
        }

        .preview-metrics {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .conflict-view {
          padding-left: 16px;
          padding-right: 16px;
        }

        .conflict-view-head {
          flex-direction: column;
        }

        .conflict-overview-entity,
        .ambiguous-entity {
          grid-template-columns: minmax(0, 1fr) auto;
        }

        .conflict-source-badges,
        .ambiguous-reason {
          grid-column: 1 / -1;
          max-width: none;
        }


        .hero {
          flex-direction: column;
          padding: 20px 16px 16px;
        }

        .hero-actions {
          width: 100%;
        }

        .assist-summary {
          flex: 1;
          min-width: 0;
        }

        .status-tabs {
          grid-template-columns: 1fr;
          padding: 14px 16px 0;
        }

        .status-tab {
          min-height: 58px;
        }

        .filters-panel,
        .list-shell {
          margin-left: 16px;
          margin-right: 16px;
        }

        .actions {
          padding-left: 16px;
          padding-right: 16px;
          align-items: flex-start;
          flex-direction: column;
        }

        .action-buttons {
          width: 100%;
          justify-content: stretch;
        }

        .btn {
          flex: 1 1 150px;
        }

        .table-head {
          display: none;
        }

        .entity-row {
          grid-template-columns: 32px minmax(0, 1fr) auto;
          grid-template-areas:
            "select entity assist"
            "select location assist";
          gap: 7px 9px;
          min-height: 104px;
          padding: 12px;
        }

        .select-cell { grid-area: select; align-self: center; }
        .entity-main { grid-area: entity; padding-right: 0; }
        .location-cell { grid-area: location; padding-right: 0; padding-left: 54px; }
        .assist-cell {
          grid-area: assist;
          align-self: stretch;
          justify-content: center;
          justify-items: stretch;
          gap: 6px;
        }

        .assistant-switches {
          grid-auto-flow: row;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          justify-content: stretch;
        }

        .assistant-mini {
          width: 100%;
        }

        .assistant-count {
          min-width: 0;
          text-align: center;
        }

        .status-wrap {
          text-align: center;
        }

        .status {
          padding: 5px 7px;
          font-size: 0;
        }

        .status ha-icon {
          --mdc-icon-size: 18px;
        }

        .status-detail {
          display: none;
        }

        .switch {
          width: 46px;
          height: 26px;
        }

        .slider:before {
          width: 20px;
          height: 20px;
        }

        .switch input:checked + .slider:before {
          transform: translateX(20px);
        }

        .footer-note {
          padding-left: 16px;
          padding-right: 16px;
        }
      }

      @media (max-width: 560px) {
        .assist-summary {
          grid-template-columns: auto 1fr auto;
        }

        .filter-row {
          grid-template-columns: 1fr;
        }

        .entity-icon {
          width: 38px;
          height: 38px;
          border-radius: 11px;
        }

        .location-cell {
          padding-left: 50px;
        }

        .entity-name {
          font-size: 13px;
        }

        .domain-chip,
        .category-chip,
        .device-class-chip {
          display: none;
        }

        .device-group-header {
          grid-template-columns: 22px 34px minmax(0, 1fr);
          grid-template-areas:
            "chevron icon copy"
            "chevron icon platforms";
        }

        .device-group-counts {
          display: none;
        }

        .device-group-entities {
          padding-left: 6px;
        }

        .ha-links {
          padding-left: 16px;
          padding-right: 16px;
        }
      }
    `;
  }
}

if (!customElements.get("assist-entity-manager-en")) {
  customElements.define("assist-entity-manager-en", AssistEntityManager);
}
