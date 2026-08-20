/* Assist Entity Manager runtime compatibility fixes – v1.1.3 */
const AEM_RUNTIME_FIX_VERSION = "1.1.3";

function hasCurrentState(instance, entityId) {
  return Boolean(instance?._hass?.states) && Object.prototype.hasOwnProperty.call(instance._hass.states, entityId);
}

function markOrphanedEntities(instance) {
  if (!Array.isArray(instance?._entities) || !instance?._hass?.states) return;
  for (const entity of instance._entities) {
    entity.orphaned = Boolean(entity?.entityId) && !hasCurrentState(instance, entity.entityId);
  }
}

function installEntityPresenceGuard(tagName) {
  customElements.whenDefined(tagName).then(() => {
    const ElementClass = customElements.get(tagName);
    const proto = ElementClass?.prototype;
    if (!proto || proto.__aemEntityPresenceGuardInstalled) return;

    const originalProcessExternalChanges = proto._processExternalChanges;
    if (typeof originalProcessExternalChanges !== "function") return;

    Object.defineProperty(proto, "__aemEntityPresenceGuardInstalled", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    proto._processExternalChanges = function (...args) {
      markOrphanedEntities(this);
      return originalProcessExternalChanges.apply(this, args);
    };

    const originalRender = proto._render;
    if (typeof originalRender === "function") {
      proto._render = function (...args) {
        const result = originalRender.apply(this, args);
        queueMicrotask(() => applyEntityCleanupUi(this));
        return result;
      };
    }

    refreshExistingInstances(tagName);
  });
}

function collectOpenShadowRoots(root, roots = []) {
  roots.push(root);
  const elements = root.querySelectorAll?.("*") || [];
  for (const element of elements) {
    if (element.shadowRoot) collectOpenShadowRoots(element.shadowRoot, roots);
  }
  return roots;
}

function refreshExistingInstances(tagName) {
  queueMicrotask(() => {
    for (const root of collectOpenShadowRoots(document)) {
      for (const instance of root.querySelectorAll?.(tagName) || []) {
        if (instance._loading) continue;
        instance._loaded = false;
        instance._aliasIndexReady = false;
        instance._aliasIndexError = "";
        instance._load?.();
      }
    }
  });
}

function cleanupTexts(instance) {
  const de = String(instance?._hass?.language || "").toLowerCase().startsWith("de");
  return de
    ? {
        orphanBadge: "Verwaist",
        title: "Entität aus Home Assistant entfernen",
        orphanHelp: "Diese Entität hat keinen aktuellen Home-Assistant-State mehr. Der verwaiste Registry-Eintrag kann dauerhaft entfernt werden.",
        activeHelp: "Diese Entität ist noch aktiv und wird von Home Assistant oder einer Integration verwaltet. Entferne zuerst die eigentliche Quelle; AEM löscht aktive Quell-Entitäten nicht blind aus der Registry.",
        button: "Restlos aus Home Assistant löschen",
        confirm: "Den verwaisten Registry-Eintrag wirklich dauerhaft aus Home Assistant löschen?",
        deleting: "Wird gelöscht …",
        error: "Die Entität konnte nicht gelöscht werden.",
      }
    : {
        orphanBadge: "Orphaned",
        title: "Remove entity from Home Assistant",
        orphanHelp: "This entity no longer has a current Home Assistant state. The orphaned registry entry can be removed permanently.",
        activeHelp: "This entity is still active and is managed by Home Assistant or an integration. Remove its actual source first; AEM will not blindly remove active source-managed entities from the registry.",
        button: "Permanently remove from Home Assistant",
        confirm: "Permanently remove this orphaned registry entry from Home Assistant?",
        deleting: "Removing …",
        error: "The entity could not be removed.",
      };
}

function injectCleanupStyles(instance) {
  const root = instance?.shadowRoot;
  if (!root || root.querySelector("style[data-aem-cleanup-style]")) return;
  const style = document.createElement("style");
  style.dataset.aemCleanupStyle = "1";
  style.textContent = `
    .aem-orphan-badge{display:inline-flex;align-items:center;gap:4px;margin-left:7px;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--warning-color,#ff9800) 16%,transparent);border:1px solid color-mix(in srgb,var(--warning-color,#ff9800) 42%,transparent);color:var(--warning-color,#ff9800);font-size:10px;font-weight:700;vertical-align:middle}
    .aem-cleanup-section{margin:18px 0 4px;padding:14px;border:1px solid color-mix(in srgb,var(--error-color,#e53935) 32%,var(--divider-color));border-radius:14px;background:color-mix(in srgb,var(--error-color,#e53935) 5%,var(--card-background-color,var(--ha-card-background)))}
    .aem-cleanup-section strong,.aem-cleanup-section small{display:block}.aem-cleanup-section strong{font-size:13px}.aem-cleanup-section small{margin-top:5px;color:var(--secondary-text-color);font-size:10px;line-height:1.45}
    .aem-cleanup-button{margin-top:12px;padding:9px 12px;border:1px solid var(--error-color,#e53935);border-radius:10px;background:var(--error-color,#e53935);color:#fff;font:inherit;font-size:11px;font-weight:700;cursor:pointer}.aem-cleanup-button:disabled{opacity:.38;cursor:not-allowed}
    .aem-cleanup-error{margin-top:8px;color:var(--error-color,#e53935);font-size:10px}
  `;
  root.appendChild(style);
}

function markOrphanRow(instance, entityId, texts) {
  const root = instance?.shadowRoot;
  if (!root || !entityId) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (String(node.nodeValue || "").trim() !== entityId) continue;
    const parent = node.parentElement;
    if (!parent || parent.querySelector?.(".aem-orphan-badge")) continue;
    const badge = document.createElement("span");
    badge.className = "aem-orphan-badge";
    badge.textContent = texts.orphanBadge;
    parent.appendChild(badge);
  }
}

function applyEntityCleanupUi(instance) {
  if (!instance?.shadowRoot || !Array.isArray(instance._entities)) return;
  markOrphanedEntities(instance);
  injectCleanupStyles(instance);
  const texts = cleanupTexts(instance);

  for (const entity of instance._entities) {
    if (entity.orphaned) markOrphanRow(instance, entity.entityId, texts);
  }

  const entityId = instance._detailEntityId;
  const panel = instance.shadowRoot.querySelector(".detail-panel");
  if (!entityId || !panel || panel.querySelector(".aem-cleanup-section")) return;

  const entity = instance._entities.find((item) => item.entityId === entityId);
  if (!entity) return;
  const orphaned = Boolean(entity.orphaned);

  const section = document.createElement("section");
  section.className = "aem-cleanup-section";
  section.innerHTML = `
    <strong>${escapeRuntimeHtml(texts.title)}${orphaned ? ` <span class="aem-orphan-badge">${escapeRuntimeHtml(texts.orphanBadge)}</span>` : ""}</strong>
    <small>${escapeRuntimeHtml(orphaned ? texts.orphanHelp : texts.activeHelp)}</small>
    <button class="aem-cleanup-button" type="button" ${orphaned ? "" : "disabled"}>${escapeRuntimeHtml(texts.button)}</button>
    <div class="aem-cleanup-error" hidden></div>
  `;

  const button = section.querySelector(".aem-cleanup-button");
  const error = section.querySelector(".aem-cleanup-error");
  button?.addEventListener("click", async () => {
    if (!orphaned || button.disabled) return;
    if (!window.confirm(`${texts.confirm}\n\n${entityId}`)) return;

    button.disabled = true;
    button.textContent = texts.deleting;
    error.hidden = true;
    error.textContent = "";

    try {
      await instance._callWS({
        type: "assist_entity_manager/entity/remove_orphan",
        entity_id: entityId,
      });
      instance._detailEntityId = null;
      instance._detailRegistry = null;
      instance._detailLoading = false;
      instance._detailError = "";
      instance._loaded = false;
      instance._aliasIndexReady = false;
      instance._aliasIndexError = "";
      await instance._load?.();
    } catch (err) {
      error.textContent = err?.message || texts.error;
      error.hidden = false;
      button.disabled = false;
      button.textContent = texts.button;
    }
  });

  panel.appendChild(section);
}

function escapeRuntimeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const ENGLISH_EXACT = new Map([
  ["HOME ASSISTANT SPRACHASSISTENTEN", "HOME ASSISTANT VOICE ASSISTANTS"],
  ["EINSTELLUNGEN", "SETTINGS"],
  ["SICHERUNG", "BACKUP"],
  ["Ausgeschlossen:", "Excluded:"],
  ["Sperren", "Block"],
  ["Freigeben", "Expose"],
  ["Schloss", "Lock"],
  ["Wasser", "Water"],
  ["ausgeblendet", "hidden"],
  ["von", "of"],
  ["sichtbar", "visible"],
]);

const ENGLISH_SUBSTRINGS = [
  [" bei mindestens einem Assistenten aktiv", " active on at least one assistant"],
  ["Home Assistant meldet diese Entity jetzt als not supported.", "Home Assistant now reports this entity as not supported."],
  ["Der Name deutet auf eine technische Diagnostic- oder Wartungsinformation hin.", "The name suggests technical diagnostic or maintenance information."],
  ["Entfernt sie nur aus dieser Ansicht. In Home Assistant selbst is nichts changed.", "Only hides them from this view. Nothing is changed in Home Assistant itself."],
  ["Warnt bei sehr allgemeinen spoken Namen wie „Light“, „Switch“ oder „Temperature“.", "Warns about very generic spoken names such as “Light”, “Switch”, or “Temperature”."],
  [" currentlye hints", " current hints"],
  ["einen Voice assistants", "a voice assistant"],
  [" exposure changeen", " exposure changes"],
  ["nicht exposed", "not exposed"],
];

function translateEnglishText(value) {
  let text = String(value ?? "");
  const leading = text.match(/^\s*/)?.[0] || "";
  const trailing = text.match(/\s*$/)?.[0] || "";
  const trimmed = text.trim();

  if (ENGLISH_EXACT.has(trimmed)) {
    text = `${leading}${ENGLISH_EXACT.get(trimmed)}${trailing}`;
  }

  for (const [from, to] of ENGLISH_SUBSTRINGS) text = text.replaceAll(from, to);

  text = text
    .replace(/\b(\d+)\s+von\s+(\d+)\s+exposed\b/g, "$1 of $2 exposed")
    .replace(/\b(\d+)\s+von\s+(\d+)\b/g, "$1 of $2")
    .replace(/\b(\d+)\s+sichtbar\b/g, "$1 visible")
    .replace(/\b(\d+) Doppelung\b/g, "$1 duplicate")
    .replace(/\b(\d+) Doppelungen\b/g, "$1 duplicates")
    .replace(/exposure was changed outside Assist Manager aktiviert\./g, "Exposure was enabled outside Assist Manager.")
    .replace(/exposure was changed outside Assist Manager deaktiviert\./g, "Exposure was disabled outside Assist Manager.")
    .replace(/It was previously exposed to (.+?) exposed\./g, "It was previously exposed to $1.");

  return text;
}

function applyEnglishCleanup(instance) {
  const root = instance?.shadowRoot;
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const next = translateEnglishText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  for (const element of root.querySelectorAll("[placeholder], [title], [aria-label]")) {
    for (const attr of ["placeholder", "title", "aria-label"]) {
      if (!element.hasAttribute(attr)) continue;
      let value = element.getAttribute(attr) || "";
      value = value.replace("z. B. Deckenlampe, Hauptlicht …", "e.g. ceiling light, main light …");
      const next = translateEnglishText(value);
      if (next !== element.getAttribute(attr)) element.setAttribute(attr, next);
    }
  }
}

function ensureEnglishCleanupObserver(instance) {
  const root = instance?.shadowRoot;
  if (!root) return;

  applyEnglishCleanup(instance);
  if (instance.__aemEnglishCleanupObserver) return;

  const observer = new MutationObserver(() => {
    queueMicrotask(() => applyEnglishCleanup(instance));
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label"],
  });
  instance.__aemEnglishCleanupObserver = observer;
}

function installEnglishCleanup() {
  customElements.whenDefined("assist-entity-manager-en").then(() => {
    const ElementClass = customElements.get("assist-entity-manager-en");
    const proto = ElementClass?.prototype;
    if (!proto || proto.__aemEnglishCleanupInstalled) return;

    Object.defineProperty(proto, "__aemEnglishCleanupInstalled", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    const originalRender = proto._render;
    if (typeof originalRender === "function") {
      proto._render = function (...args) {
        const result = originalRender.apply(this, args);
        queueMicrotask(() => ensureEnglishCleanupObserver(this));
        return result;
      };
    }

    const originalTranslateDeviceClass = proto._translateDeviceClass;
    if (typeof originalTranslateDeviceClass === "function") {
      proto._translateDeviceClass = function (...args) {
        const result = originalTranslateDeviceClass.apply(this, args);
        if (result === "Schloss") return "Lock";
        if (result === "Wasser") return "Water";
        return result;
      };
    }

    const applyToExisting = () => {
      for (const root of collectOpenShadowRoots(document)) {
        for (const instance of root.querySelectorAll?.("assist-entity-manager-en") || []) {
          ensureEnglishCleanupObserver(instance);
        }
      }
    };

    applyToExisting();
    window.setTimeout(applyToExisting, 250);
    window.setTimeout(applyToExisting, 1000);
  });
}

function updateVisibleVersionLabels() {
  for (const root of collectOpenShadowRoots(document)) {
    for (const button of root.querySelectorAll?.(".aem-version-trigger") || []) {
      if (/^AEM\s+1\.1\.[12]$/.test(button.textContent?.trim() || "")) {
        button.textContent = `AEM ${AEM_RUNTIME_FIX_VERSION}`;
      }
    }
  }
}

installEntityPresenceGuard("assist-entity-manager-de");
installEntityPresenceGuard("assist-entity-manager-en");
installEnglishCleanup();

customElements.whenDefined("assist-entity-manager-panel").then(() => {
  window.setTimeout(updateVisibleVersionLabels, 0);
  window.setTimeout(updateVisibleVersionLabels, 500);
});

console.info(`Assist Entity Manager runtime fixes ${AEM_RUNTIME_FIX_VERSION} loaded`);
