/* Assist Entity Manager runtime compatibility fixes – v1.2.0 */
const AEM_RUNTIME_FIX_VERSION="1.2.0";
console.info(`Assist Entity Manager runtime fixes ${AEM_RUNTIME_FIX_VERSION} loaded`);

// English compatibility fallback for dynamically rendered text.
const AEM_ENGLISH_EXACT_RC2 = new Map([
  ["HOME ASSISTANT SPRACHASSISTENTEN", "HOME ASSISTANT VOICE ASSISTANTS"],
  ["EINSTELLUNGEN", "SETTINGS"],
  ["SICHERUNG", "BACKUP"],
  ["Zur entity list", "Back to entity list"],
  ["Als gesehen markieren", "Mark as seen"],
  ["Ausgeschlossen:", "Excluded:"],
  ["Sperren", "Block"],
  ["Freigeben", "Expose"],
  ["Schloss", "Lock"],
  ["Wasser", "Water"],
  ["ausgeblendet", "hidden"],
  ["von", "of"],
  ["sichtbar", "visible"],
]);

const AEM_ENGLISH_SUBSTRINGS_RC2 = [
  [" bei mindestens einem Assistenten aktiv", " active on at least one assistant"],
  ["Home Assistant meldet diese Entity jetzt als not supported.", "Home Assistant now reports this entity as not supported."],
  ["Der Name deutet auf eine technische Diagnostic- oder Wartungsinformation hin.", "The name suggests technical diagnostic or maintenance information."],
  ["Entfernt sie nur aus dieser Ansicht. In Home Assistant selbst is nichts changed.", "Only hides them from this view. Nothing is changed in Home Assistant itself."],
  ["Warnt bei sehr allgemeinen spoken Namen wie „Light“, „Switch“ oder „Temperature“.", "Warns about very generic spoken names such as “Light”, “Switch” or “Temperature”."],
  [" currentlye hints", " current hints"],
  ["einen Voice assistants", "a voice assistant"],
  [" exposure changeen", " exposure changes"],
  ["nicht exposed", "not exposed"],
];

function aemEnglishRc2(value) {
  let text = String(value ?? "");
  const leading = text.match(/^\s*/)?.[0] || "";
  const trailing = text.match(/\s*$/)?.[0] || "";
  const trimmed = text.trim();
  if (AEM_ENGLISH_EXACT_RC2.has(trimmed)) {
    text = `${leading}${AEM_ENGLISH_EXACT_RC2.get(trimmed)}${trailing}`;
  }
  for (const [from, to] of AEM_ENGLISH_SUBSTRINGS_RC2) {
    text = text.replaceAll(from, to);
  }
  return text
    .replace(/\b(\d+)\s+von\s+(\d+)\s+exposed\b/g, "$1 of $2 exposed")
    .replace(/\b(\d+)\s+von\s+(\d+)\b/g, "$1 of $2")
    .replace(/\b(\d+)\s+sichtbar\b/g, "$1 visible")
    .replace(/\b(\d+) Doppelung\b/g, "$1 duplicate")
    .replace(/\b(\d+) Doppelungen\b/g, "$1 duplicates")
    .replace(/exposure was changed outside Assist Manager aktiviert\./g, "Exposure was enabled outside Assist Manager.")
    .replace(/exposure was changed outside Assist Manager deaktiviert\./g, "Exposure was disabled outside Assist Manager.");
}

function aemApplyEnglishRc2(instance) {
  const root = instance?.shadowRoot;
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const next = aemEnglishRc2(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }
  for (const element of root.querySelectorAll("[placeholder], [title], [aria-label]")) {
    for (const attr of ["placeholder", "title", "aria-label"]) {
      if (!element.hasAttribute(attr)) continue;
      let value = element.getAttribute(attr) || "";
      value = value.replace("z. B. Deckenlampe, Hauptlicht …", "e.g. ceiling light, main light …");
      const next = aemEnglishRc2(value);
      if (next !== value) element.setAttribute(attr, next);
    }
  }
}

customElements.whenDefined("assist-entity-manager-en").then(() => {
  const proto = customElements.get("assist-entity-manager-en")?.prototype;
  if (!proto || proto.__aemEnglishRc2Installed) return;
  Object.defineProperty(proto, "__aemEnglishRc2Installed", { value: true });
  const originalRender = proto._render;
  if (typeof originalRender === "function") {
    proto._render = function (...args) {
      const result = originalRender.apply(this, args);
      queueMicrotask(() => {
        aemApplyEnglishRc2(this);
        if (!this.__aemEnglishRc2Observer && this.shadowRoot) {
          const observer = new MutationObserver(() => queueMicrotask(() => aemApplyEnglishRc2(this)));
          observer.observe(this.shadowRoot, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["placeholder", "title", "aria-label"],
          });
          this.__aemEnglishRc2Observer = observer;
        }
      });
      return result;
    };
  }
});
