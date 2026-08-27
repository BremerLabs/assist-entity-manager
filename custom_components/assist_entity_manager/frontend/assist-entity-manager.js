/* Assist Entity Manager language loader – v1.2.0 */
const AEM_VERSION = "1.2.0";
const AEM_BASE = "/assist_entity_manager";

function aemLanguage(hass) {
  const lang = String(hass?.language || "").toLowerCase();
  return lang === "de" || lang.startsWith("de-") ? "de" : "en";
}

const loaded = new Map();
async function ensureAemLanguage(lang) {
  if (!loaded.has(lang)) {
    loaded.set(
      lang,
      import(`${AEM_BASE}/assist-entity-manager.${lang}.js?v=${AEM_VERSION}`)
    );
  }
  return loaded.get(lang);
}

class AssistEntityManagerLoader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {};
    this._inner = null;
    this._lang = null;
    this._token = 0;
    this._registryUnsubscribers = [];
    this._registrySubscriptionToken = 0;
    this._refreshTimer = null;
  }

  connectedCallback() {
    this._ensure();
    this._setupRegistrySubscriptions();
  }

  disconnectedCallback() {
    this._teardownRegistrySubscriptions();
    clearTimeout(this._refreshTimer);
  }

  setConfig(config) {
    this._config = config || {};
    this._inner?.setConfig?.(this._config);
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    const nextLang = aemLanguage(hass);

    if (this._inner && this._lang !== nextLang) {
      this._inner = null;
      this._lang = null;
      this.shadowRoot.innerHTML = "";
    }

    if (oldHass?.connection !== hass?.connection) {
      this._teardownRegistrySubscriptions();
      this._setupRegistrySubscriptions();
    }

    this._ensure();
    if (this._inner) this._inner.hass = hass;
  }

  get hass() { return this._hass; }
  getCardSize() { return this._inner?.getCardSize?.() ?? 12; }
  getGridOptions() {
    return this._inner?.getGridOptions?.() ?? {
      columns: "full",
      rows: "auto",
      min_columns: 6,
      min_rows: 4,
    };
  }

  async _ensure() {
    if (!this.isConnected || !this._hass) return;
    const lang = aemLanguage(this._hass);
    if (this._inner && this._lang === lang) return;

    const token = ++this._token;
    await ensureAemLanguage(lang);
    if (token !== this._token) return;

    const inner = document.createElement(`assist-entity-manager-${lang}`);
    this.shadowRoot.innerHTML = `<style>:host{display:block;width:100%;max-width:none}</style>`;
    this.shadowRoot.appendChild(inner);
    this._inner = inner;
    this._lang = lang;
    inner.setConfig?.(this._config);
    inner.hass = this._hass;
    this._setupRegistrySubscriptions();
  }

  _scheduleDataRefresh() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => this._refreshData(), 550);
  }

  _refreshData() {
    const inner = this._inner;
    if (!inner || !this.isConnected) return;
    if (inner._loading) {
      this._scheduleDataRefresh();
      return;
    }

    inner._loaded = false;
    inner._aliasIndexReady = false;
    inner._aliasIndexError = "";
    inner._load?.();
  }

  _setupRegistrySubscriptions() {
    const connection = this._hass?.connection;
    if (!this.isConnected || !connection?.subscribeEvents || this._registryUnsubscribers.length) return;

    const token = ++this._registrySubscriptionToken;
    const register = async (eventType, callback) => {
      try {
        const unsubscribe = await connection.subscribeEvents(callback, eventType);
        if (token !== this._registrySubscriptionToken || !this.isConnected) {
          unsubscribe?.();
          return;
        }
        if (typeof unsubscribe === "function") this._registryUnsubscribers.push(unsubscribe);
      } catch (err) {
        console.warn(`Assist Entity Manager: could not subscribe to ${eventType}`, err);
      }
    };

    register("entity_registry_updated", () => this._scheduleDataRefresh());
    register("device_registry_updated", () => this._scheduleDataRefresh());
    register("area_registry_updated", () => this._scheduleDataRefresh());
    register("state_changed", (event) => {
      const data = event?.data || {};
      if (data.old_state == null || data.new_state == null) {
        this._scheduleDataRefresh();
      }
    });
  }

  _teardownRegistrySubscriptions() {
    ++this._registrySubscriptionToken;
    for (const unsubscribe of this._registryUnsubscribers.splice(0)) {
      try { unsubscribe(); } catch (_err) { /* no-op */ }
    }
  }
}

if (!customElements.get("assist-entity-manager")) {
  customElements.define("assist-entity-manager", AssistEntityManagerLoader);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "assist-entity-manager")) {
  window.customCards.push({
    type: "assist-entity-manager",
    name: "Assist Entity Manager",
    description: "Manage Home Assistant voice-assistant entity exposure and aliases.",
    preview: false,
  });
}

class AssistEntityManagerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._manager = null;
    this._rendered = false;
    this._developerUnlocked = false;
    this._developerOpen = false;
    this._developerClicks = 0;
    this._developerClickTimer = null;
    this._developerLoading = false;
    this._developerError = "";
    this._developerData = null;
  }

  connectedCallback() { this._ensureRendered(); }

  set hass(hass) {
    this._hass = hass;
    this._ensureRendered();
    if (this._manager) this._manager.hass = hass;
    if (!this._isAdmin() && this._developerOpen) {
      this._developerOpen = false;
      this._developerUnlocked = false;
      this._renderDeveloperPanel();
    }
  }

  get hass() { return this._hass; }
  set narrow(value) { this._narrow = Boolean(value); }
  set route(value) { this._route = value; }
  set panel(value) { this._panel = value; }

  _isAdmin() {
    return this._hass?.user?.is_admin === true;
  }

  _texts() {
    const de = aemLanguage(this._hass) === "de";
    return de
      ? {
          title: "Entwickler / Erweitert",
          intro: "Versteckte AEM-Kompatibilitätseinstellungen für Administratoren.",
          semantic: "Semantic-Control-Erweiterungen verwenden",
          semanticHelp: "Schaltet nur die AEM-Anbindung ein oder aus. Assist Semantic Control selbst wird nicht verändert.",
          provider: "Provider-Status",
          loading: "Status wird geladen …",
          close: "Schließen",
          noAdapter: "Kein kompatibler AEM-Provider-Adapter verfügbar",
          disabled: "In AEM deaktiviert",
          compatible: "Kompatibel",
          incompatible: "Inkompatibel",
          unavailable: "Vorübergehend nicht erreichbar",
          incomplete: "Unvollständige Provider-Informationen",
          capabilities: "Fähigkeiten",
          contract: "Vertragsversion",
          error: "Status konnte nicht geladen werden.",
        }
      : {
          title: "Developer / Advanced",
          intro: "Hidden AEM compatibility settings for administrators.",
          semantic: "Use Semantic Control extensions",
          semanticHelp: "Only enables or disables AEM's connection. Assist Semantic Control itself is not changed.",
          provider: "Provider status",
          loading: "Loading status …",
          close: "Close",
          noAdapter: "No compatible AEM provider adapter is available",
          disabled: "Disabled in AEM",
          compatible: "Compatible",
          incompatible: "Incompatible",
          unavailable: "Temporarily unavailable",
          incomplete: "Incomplete provider information",
          capabilities: "Capabilities",
          contract: "Contract version",
          error: "Status could not be loaded.",
        };
  }

  async _callWS(message) {
    if (!this._hass) throw new Error("Home Assistant is not available.");
    if (typeof this._hass.callWS === "function") return await this._hass.callWS(message);
    const response = await this._hass.connection.sendMessagePromise(message);
    return response?.result ?? response;
  }

  _handleVersionClick() {
    if (!this._isAdmin()) return;
    if (this._developerUnlocked) {
      this._developerOpen = true;
      this._renderDeveloperPanel();
      this._loadDeveloperState();
      return;
    }

    this._developerClicks += 1;
    clearTimeout(this._developerClickTimer);
    this._developerClickTimer = window.setTimeout(() => {
      this._developerClicks = 0;
    }, 4000);

    if (this._developerClicks >= 5) {
      this._developerClicks = 0;
      this._developerUnlocked = true;
      this._developerOpen = true;
      this._renderDeveloperPanel();
      this._loadDeveloperState();
    }
  }

  async _loadDeveloperState() {
    if (!this._isAdmin() || !this._developerOpen) return;
    this._developerLoading = true;
    this._developerError = "";
    this._renderDeveloperPanel();
    try {
      this._developerData = await this._callWS({ type: "assist_entity_manager/settings/get" });
    } catch (err) {
      console.warn("Assist Entity Manager: developer settings unavailable", err);
      this._developerError = err?.message || this._texts().error;
    } finally {
      this._developerLoading = false;
      this._renderDeveloperPanel();
    }
  }

  async _updateSemanticSetting(enabled) {
    if (!this._isAdmin()) return;
    this._developerLoading = true;
    this._developerError = "";
    this._renderDeveloperPanel();
    try {
      this._developerData = await this._callWS({
        type: "assist_entity_manager/settings/update",
        use_semantic_control_extensions: Boolean(enabled),
      });
    } catch (err) {
      console.warn("Assist Entity Manager: developer setting could not be saved", err);
      this._developerError = err?.message || this._texts().error;
    } finally {
      this._developerLoading = false;
      this._renderDeveloperPanel();
    }
  }

  _providerStatusLabel(state) {
    const t = this._texts();
    return ({
      disabled: t.disabled,
      not_available: t.noAdapter,
      compatible: t.compatible,
      incompatible: t.incompatible,
      unavailable: t.unavailable,
      incomplete: t.incomplete,
    })[state] || t.incomplete;
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _renderDeveloperPanel() {
    this.shadowRoot?.querySelector(".developer-backdrop")?.remove();
    if (!this._developerOpen || !this._isAdmin()) return;

    const t = this._texts();
    const data = this._developerData || {};
    const settings = data.settings || {};
    const semantic = data.semantic_control || {};
    const enabled = settings.use_semantic_control_extensions !== false;
    const capabilities = Array.isArray(semantic.capabilities) ? semantic.capabilities : [];

    const wrapper = document.createElement("div");
    wrapper.className = "developer-backdrop";
    wrapper.innerHTML = `
      <section class="developer-panel" role="dialog" aria-modal="true" aria-label="${this._escape(t.title)}">
        <div class="developer-head">
          <div>
            <small>AEM ${AEM_VERSION}</small>
            <h2>${this._escape(t.title)}</h2>
            <p>${this._escape(t.intro)}</p>
          </div>
          <button class="developer-close" type="button" title="${this._escape(t.close)}">×</button>
        </div>
        <div class="developer-body">
          ${this._developerError ? `<div class="developer-error">${this._escape(this._developerError)}</div>` : ""}
          <label class="developer-setting">
            <span>
              <strong>${this._escape(t.semantic)}</strong>
              <small>${this._escape(t.semanticHelp)}</small>
            </span>
            <input id="developer-semantic-toggle" type="checkbox" ${enabled ? "checked" : ""} ${this._developerLoading ? "disabled" : ""}>
          </label>
          <div class="developer-status">
            <span>${this._escape(t.provider)}</span>
            <strong>${this._developerLoading ? this._escape(t.loading) : this._escape(this._providerStatusLabel(semantic.state))}</strong>
            ${semantic.provider_name ? `<small>${this._escape(semantic.provider_name)}</small>` : ""}
            ${semantic.contract_version ? `<small>${this._escape(t.contract)}: ${this._escape(semantic.contract_version)}</small>` : ""}
            ${capabilities.length ? `<small>${this._escape(t.capabilities)}: ${capabilities.map((item) => this._escape(item)).join(", ")}</small>` : ""}
            ${semantic.error && semantic.state !== "not_available" ? `<small class="developer-status-error">${this._escape(semantic.error)}</small>` : ""}
          </div>
        </div>
      </section>`;

    wrapper.addEventListener("click", (event) => {
      if (event.target === wrapper) {
        this._developerOpen = false;
        this._renderDeveloperPanel();
      }
    });
    wrapper.querySelector(".developer-close")?.addEventListener("click", () => {
      this._developerOpen = false;
      this._renderDeveloperPanel();
    });
    wrapper.querySelector("#developer-semantic-toggle")?.addEventListener("change", (event) => {
      this._updateSemanticSetting(event.target.checked);
    });
    this.shadowRoot.appendChild(wrapper);
  }

  _ensureRendered() {
    if (this._rendered || !this.shadowRoot) return;
    this._rendered = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;min-height:100%;background:linear-gradient(180deg,color-mix(in srgb,var(--primary-background-color) 84%,transparent),color-mix(in srgb,var(--primary-background-color) 94%,transparent)),url('/assist_entity_manager/assist-manager-background.svg') center/cover fixed,var(--primary-background-color)}
        .panel-shell{box-sizing:border-box;width:100%;min-height:100vh;padding:clamp(10px,1.6vw,24px)}
        assist-entity-manager{display:block;width:100%;max-width:1800px;margin:0 auto}
        .aem-version-trigger{display:block;margin:7px auto 0;padding:2px 7px;border:0;background:transparent;color:var(--secondary-text-color);opacity:.38;font:inherit;font-size:9px;cursor:default}
        .developer-backdrop{position:fixed;inset:0;z-index:11000;display:flex;justify-content:flex-end;background:rgba(0,0,0,.42);backdrop-filter:blur(2px)}
        .developer-panel{width:min(520px,96vw);height:100%;overflow:auto;color:var(--primary-text-color);background:var(--card-background-color,var(--ha-card-background));border-left:1px solid var(--divider-color);box-shadow:-16px 0 44px rgba(0,0,0,.26)}
        .developer-head{display:flex;justify-content:space-between;gap:16px;padding:22px 24px;border-bottom:1px solid var(--divider-color)}
        .developer-head small{color:var(--primary-color);font-weight:800;letter-spacing:.06em}.developer-head h2{margin:4px 0 0;font-size:21px}.developer-head p{margin:5px 0 0;color:var(--secondary-text-color);font-size:11px;line-height:1.45}
        .developer-close{width:34px;height:34px;border:1px solid var(--divider-color);border-radius:10px;background:var(--secondary-background-color);color:var(--primary-text-color);font-size:22px;cursor:pointer}
        .developer-body{display:grid;gap:14px;padding:20px 24px}.developer-setting{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px;border:1px solid var(--divider-color);border-radius:14px;background:var(--secondary-background-color)}
        .developer-setting strong,.developer-setting small{display:block}.developer-setting strong{font-size:13px}.developer-setting small{margin-top:4px;color:var(--secondary-text-color);font-size:10px;line-height:1.45}.developer-setting input{width:20px;height:20px;accent-color:var(--primary-color)}
        .developer-status{display:grid;gap:5px;padding:14px;border:1px solid var(--divider-color);border-radius:14px}.developer-status>span{color:var(--secondary-text-color);font-size:10px;text-transform:uppercase;letter-spacing:.06em}.developer-status strong{font-size:13px}.developer-status small{color:var(--secondary-text-color);font-size:10px;overflow-wrap:anywhere}.developer-status-error,.developer-error{color:var(--error-color,#e53935)!important}.developer-error{padding:10px 12px;border:1px solid color-mix(in srgb,var(--error-color,#e53935) 35%,var(--divider-color));border-radius:11px;font-size:10px}
        @media(max-width:720px){.panel-shell{padding:8px}}
      </style>
      <main class="panel-shell">
        <assist-entity-manager id="manager"></assist-entity-manager>
        <button class="aem-version-trigger" type="button" aria-label="Assist Entity Manager version">AEM ${AEM_VERSION}</button>
      </main>`;
    this._manager = this.shadowRoot.querySelector("#manager");
    this._manager?.setConfig({ panel_mode: true });
    if (this._hass && this._manager) this._manager.hass = this._hass;
    this.shadowRoot.querySelector(".aem-version-trigger")?.addEventListener("click", () => this._handleVersionClick());
  }
}

if (!customElements.get("assist-entity-manager-panel")) {
  customElements.define("assist-entity-manager-panel", AssistEntityManagerPanel);
}

console.info("%c Assist Entity Manager %c 1.2.0 ",
  "background:#03a9f4;color:#fff;font-weight:700;padding:2px 5px;border-radius:3px 0 0 3px",
  "background:#263238;color:#fff;padding:2px 5px;border-radius:0 3px 3px 0");
