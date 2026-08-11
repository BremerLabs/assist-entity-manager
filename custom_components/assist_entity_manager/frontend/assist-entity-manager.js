/* Assist Entity Manager language loader – v1.0.0 */
const AEM_VERSION = "1.0.0";
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
  }

  connectedCallback() { this._ensure(); }
  setConfig(config) {
    this._config = config || {};
    if (this._inner?.setConfig) this._inner.setConfig(this._config);
  }
  set hass(hass) {
    const oldLang = this._lang;
    this._hass = hass;
    const nextLang = aemLanguage(hass);
    if (oldLang && oldLang !== nextLang) {
      this._inner = null;
      this._lang = null;
      this.shadowRoot.innerHTML = "";
    }
    this._ensure();
    if (this._inner) this._inner.hass = hass;
  }
  get hass() { return this._hass; }
  getCardSize() { return this._inner?.getCardSize?.() ?? 12; }
  getGridOptions() {
    return this._inner?.getGridOptions?.() ?? {
      columns: "full", rows: "auto", min_columns: 6, min_rows: 4,
    };
  }

  async _ensure() {
    if (!this.isConnected || !this._hass) return;
    const lang = aemLanguage(this._hass);
    if (this._inner && this._lang === lang) return;
    const token = ++this._token;
    await ensureAemLanguage(lang);
    if (token !== this._token) return;

    const tag = `assist-entity-manager-${lang}`;
    const inner = document.createElement(tag);
    this.shadowRoot.innerHTML = `<style>:host{display:block;width:100%;max-width:none}</style>`;
    this.shadowRoot.appendChild(inner);
    this._inner = inner;
    this._lang = lang;
    inner.setConfig?.(this._config);
    inner.hass = this._hass;
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
  }
  connectedCallback() { this._ensureRendered(); }
  set hass(hass) {
    this._hass = hass;
    this._ensureRendered();
    if (this._manager) this._manager.hass = hass;
  }
  get hass() { return this._hass; }
  set narrow(value) { this._narrow = Boolean(value); }
  set route(value) { this._route = value; }
  set panel(value) { this._panel = value; }
  _ensureRendered() {
    if (this._rendered || !this.shadowRoot) return;
    this._rendered = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; min-height:100%; background:
          linear-gradient(180deg,
            color-mix(in srgb, var(--primary-background-color) 84%, transparent),
            color-mix(in srgb, var(--primary-background-color) 94%, transparent)),
          url('/assist_entity_manager/assist-manager-background.svg') center / cover fixed,
          var(--primary-background-color); }
        .panel-shell { box-sizing:border-box; width:100%; min-height:100vh; padding:clamp(10px,1.6vw,24px); }
        assist-entity-manager { width:100%; max-width:1800px; margin:0 auto; }
        @media(max-width:720px){.panel-shell{padding:8px}}
      </style>
      <main class="panel-shell"><assist-entity-manager id="manager"></assist-entity-manager></main>`;
    this._manager = this.shadowRoot.querySelector("#manager");
    this._manager?.setConfig({ panel_mode: true });
    if (this._hass && this._manager) this._manager.hass = this._hass;
  }
}
if (!customElements.get("assist-entity-manager-panel")) {
  customElements.define("assist-entity-manager-panel", AssistEntityManagerPanel);
}
console.info("%c Assist Entity Manager %c 1.0.0 ",
  "background:#03a9f4;color:#fff;font-weight:700;padding:2px 5px;border-radius:3px 0 0 3px",
  "background:#263238;color:#fff;padding:2px 5px;border-radius:0 3px 3px 0");
