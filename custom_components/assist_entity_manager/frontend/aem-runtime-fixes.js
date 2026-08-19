/* Assist Entity Manager runtime compatibility fixes – v1.1.2 */
const AEM_RUNTIME_FIX_VERSION = "1.1.2";

function hasCurrentState(instance, entityId) {
  return Boolean(instance?._hass?.states) && Object.prototype.hasOwnProperty.call(instance._hass.states, entityId);
}

function filterOrphanedEntities(instance) {
  if (!Array.isArray(instance?._entities) || !instance?._hass?.states) return;

  const before = instance._entities.length;
  instance._entities = instance._entities.filter((entity) =>
    entity?.entityId && hasCurrentState(instance, entity.entityId)
  );

  if (instance._selected instanceof Set) {
    const visibleIds = new Set(instance._entities.map((entity) => entity.entityId));
    instance._selected = new Set(
      [...instance._selected].filter((entityId) => visibleIds.has(entityId))
    );
  }

  if (
    instance._detailEntityId &&
    !instance._entities.some((entity) => entity.entityId === instance._detailEntityId)
  ) {
    instance._detailEntityId = null;
    instance._detailRegistry = null;
    instance._detailLoading = false;
    instance._detailError = "";
  }

  if (before !== instance._entities.length) {
    instance._aliasIndexReady = false;
    instance._spokenNameIndex = new Map();
    instance._conflictGroupsCache = [];
    instance._conflictEntityIds = new Set();
    instance._conflictsByEntity = new Map();
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
      filterOrphanedEntities(this);
      return originalProcessExternalChanges.apply(this, args);
    };

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
  if (ENGLISH_EXACT.has(text)) text = ENGLISH_EXACT.get(text);
  for (const [from, to] of ENGLISH_SUBSTRINGS) text = text.replaceAll(from, to);

  text = text
    .replace(/\b(\d+) von (\d+) exposed\b/g, "$1 of $2 exposed")
    .replace(/\b(\d+) von (\d+)\b/g, "$1 of $2")
    .replace(/\b(\d+) sichtbar\b/g, "$1 visible")
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
        queueMicrotask(() => applyEnglishCleanup(this));
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

    for (const root of collectOpenShadowRoots(document)) {
      for (const instance of root.querySelectorAll?.("assist-entity-manager-en") || []) {
        applyEnglishCleanup(instance);
      }
    }
  });
}

function updateVisibleVersionLabels() {
  for (const root of collectOpenShadowRoots(document)) {
    for (const button of root.querySelectorAll?.(".aem-version-trigger") || []) {
      if (/^AEM\s+1\.1\.1$/.test(button.textContent?.trim() || "")) {
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
