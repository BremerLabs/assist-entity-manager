(function () {
"use strict";
/* Assist Entity Manager orphan cleanup UI – v1.2.0 */
const AEM_ORPHAN_UI_VERSION = "1.2.0";

function aemOrphanIsGerman(hass) {
  return String(hass?.language || "").toLowerCase().startsWith("de");
}

function aemOrphanEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function aemOrphanFormatAge(seconds, de) {
  const days = Math.max(0, Number(seconds || 0) / 86400);
  if (days >= 2) return `${days.toFixed(days >= 10 ? 0 : 1)} ${de ? "Tage" : "days"}`;
  const hours = days * 24;
  if (hours >= 2) return `${hours.toFixed(hours >= 10 ? 0 : 1)} ${de ? "Stunden" : "hours"}`;
  const minutes = Math.max(0, hours * 60);
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} ${de ? "Minuten" : "minutes"}`;
}

function aemOrphanFormatDate(value, hass) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(hass?.language || "de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(Number(value) * 1000));
  } catch (_err) {
    return "";
  }
}

function aemOrphanSourceLabel(reason, de) {
  const labels = de
    ? {
        not_provided: "Von der Quelle nicht mehr bereitgestellt",
        config_entry_missing: "Zugehörige Integration/Quelle fehlt",
        no_state: "Kein aktueller Home-Assistant-State",
        unavailable: "Nicht verfügbar / nicht erreichbar",
        active: "Aktiv",
      }
    : {
        not_provided: "No longer provided by its source",
        config_entry_missing: "Integration/source is missing",
        no_state: "No current Home Assistant state",
        unavailable: "Unavailable / unreachable",
        active: "Active",
      };
  return labels[reason] || reason || "–";
}

function aemOrphanReferenceTypeLabel(type, de) {
  const labels = de
    ? { automation: "Automation", script: "Skript", scene: "Szene", dashboard: "Dashboard", group: "Gruppe", person: "Person" }
    : { automation: "Automation", script: "Script", scene: "Scene", dashboard: "Dashboard", group: "Group", person: "Person" };
  return labels[type] || type || (de ? "Verwendung" : "Reference");
}

async function aemOrphanCallWS(hass, message) {
  if (!hass) throw new Error("Home Assistant is not available.");
  if (typeof hass.callWS === "function") return await hass.callWS(message);
  const response = await hass.connection.sendMessagePromise(message);
  return response?.result ?? response;
}

class AEMOrphanDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.hass = null;
    this._data = null;
    this._loading = true;
    this._error = "";
    this._message = "";
    this._preview = null;
    this._cleanupIntent = false;
    this._busy = false;
    this._onClick = this._onClick.bind(this);
    this.shadowRoot.addEventListener("click", this._onClick);
  }

  connectedCallback() {
    this._render();
    this._load();
  }

  async _load() {
    this._loading = true;
    this._error = "";
    this._render();
    try {
      this._data = await aemOrphanCallWS(this.hass, {
        type: "assist_entity_manager/orphans/list",
      });
      if (this.ownerInstance) aemOrphanApplyDataToInstance(this.ownerInstance, this._data);
      if (this.initialPreview?.entityId && !this._initialPreviewConsumed) {
        this._initialPreviewConsumed = true;
        this._loading = false;
        await this._showPreview(this.initialPreview.entityId, Boolean(this.initialPreview.cleanupIntent));
        return;
      }
    } catch (err) {
      this._error = err?.message || String(err);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _close() {
    this.remove();
  }

  async _saveDays() {
    const input = this.shadowRoot.querySelector("#aem-orphan-days");
    const days = Number.parseInt(input?.value || "", 10);
    const de = aemOrphanIsGerman(this.hass);
    if (!Number.isInteger(days) || days < 0) {
      this._error = de
        ? "Bitte eine ganze Zahl mit 0 oder mehr Tagen eingeben."
        : "Enter a whole number of 0 days or more.";
      this._render();
      return;
    }
    this._busy = true;
    this._render();
    try {
      this._data = await aemOrphanCallWS(this.hass, {
        type: "assist_entity_manager/orphans/settings/update",
        candidate_after_days: days,
      });
      this._message = de
        ? `Kandidatenfrist auf ${days} Tage gespeichert.`
        : `Candidate age saved as ${days} days.`;
      this._error = "";
    } catch (err) {
      this._error = err?.message || String(err);
    } finally {
      this._busy = false;
      this._render();
    }
  }

  async _protect(entityId, isProtected) {
    this._busy = true;
    this._render();
    try {
      await aemOrphanCallWS(this.hass, {
        type: "assist_entity_manager/orphans/protect",
        entity_id: entityId,
        protected: isProtected,
      });
      this._busy = false;
      await this._load();
    } catch (err) {
      this._error = err?.message || String(err);
      this._busy = false;
      this._render();
    }
  }

  async _showPreview(entityId, cleanupIntent) {
    this._busy = true;
    this._error = "";
    this._message = "";
    this._render();
    try {
      this._preview = await aemOrphanCallWS(this.hass, {
        type: "assist_entity_manager/orphans/preview",
        entity_id: entityId,
      });
      this._cleanupIntent = Boolean(cleanupIntent);
      if (!this._preview?.eligible) {
        const de = aemOrphanIsGerman(this.hass);
        this._error = de
          ? "Die Entität ist aktuell kein gültiger Bereinigungskandidat mehr."
          : "The entity is no longer an eligible cleanup candidate.";
      }
    } catch (err) {
      this._error = err?.message || String(err);
    } finally {
      this._busy = false;
      this._render();
    }
  }

  _openReference(index) {
    const ref = this._preview?.references?.[index];
    if (!ref) return;
    if (ref.url) {
      this._close();
      window.location.href = ref.url;
      return;
    }
    if (ref.entity_id) {
      this._close();
      const target = document.querySelector("home-assistant") || document.body;
      target.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: ref.entity_id },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  async _removePreviewEntity() {
    const preview = this._preview;
    if (!preview?.eligible || !preview?.entity?.entity_id) return;
    const de = aemOrphanIsGerman(this.hass);

    const needRefs = Boolean(preview.requires_reference_confirmation);
    const needIncomplete = Boolean(preview.requires_incomplete_confirmation);
    const needSource = Boolean(preview.requires_source_confirmation);
    const check = (id) => Boolean(this.shadowRoot.querySelector(id)?.checked);

    if (
      (needRefs && !check("#confirm-references")) ||
      (needIncomplete && !check("#confirm-incomplete")) ||
      (needSource && !check("#confirm-source")) ||
      !check("#confirm-delete")
    ) {
      this._error = de
        ? "Bitte bestätige zuerst alle angezeigten Warnungen."
        : "Confirm all displayed warnings first.";
      this._render();
      return;
    }

    this._busy = true;
    this._error = "";
    this._render();
    try {
      const result = await aemOrphanCallWS(this.hass, {
        type: "assist_entity_manager/orphans/remove",
        entity_id: preview.entity.entity_id,
        confirm_references: needRefs,
        confirm_incomplete: needIncomplete,
        confirm_source_active: needSource,
      });
      this._preview = null;
      this._cleanupIntent = false;
      this._message = result?.state_still_present
        ? de
          ? "Registry-Eintrag entfernt. Die Quelle hält aber noch einen State; die Entität kann erneut angelegt werden."
          : "Registry entry removed, but the source still has a state and may recreate the entity."
        : de
          ? "Entität wurde aus der Entity Registry entfernt."
          : "Entity was removed from the Entity Registry.";
      this._busy = false;
      await this._load();
    } catch (err) {
      this._error = err?.message || String(err);
      this._busy = false;
      this._render();
    }
  }

  _onClick(event) {
    const button = event.target?.closest?.("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const entityId = button.dataset.entityId;
    if (action === "close") this._close();
    else if (action === "back-preview") {
      this._preview = null;
      this._cleanupIntent = false;
      this._error = "";
      this._render();
    } else if (action === "refresh") this._load();
    else if (action === "save-days") this._saveDays();
    else if (action === "preview" && entityId) this._showPreview(entityId, false);
    else if (action === "cleanup" && entityId) this._showPreview(entityId, true);
    else if (action === "protect" && entityId) this._protect(entityId, true);
    else if (action === "unprotect" && entityId) this._protect(entityId, false);
    else if (action === "open-reference") this._openReference(Number(button.dataset.index));
    else if (action === "delete-confirmed") this._removePreviewEntity();
  }

  _renderCandidate(item, de) {
    const source = aemOrphanSourceLabel(item.source_reason, de);
    const age = aemOrphanFormatAge(item.unavailable_seconds, de);
    const since = aemOrphanFormatDate(item.unavailable_since, this.hass);
    const badge = item.status === "orphan_candidate"
      ? (de ? "Verwaist-Kandidat" : "Orphan candidate")
      : (de ? "Offline-Kandidat" : "Offline candidate");
    return `
      <article class="candidate-card">
        <div class="candidate-main">
          <div class="candidate-title-row">
            <strong>${aemOrphanEscape(item.name || item.entity_id)}</strong>
            <span class="badge warning">${aemOrphanEscape(badge)}</span>
          </div>
          <code>${aemOrphanEscape(item.entity_id)}</code>
          <div class="candidate-meta">${aemOrphanEscape(source)} · ${de ? "seit" : "for"} ${aemOrphanEscape(age)}${since ? ` · ${de ? "Beginn" : "since"}: ${aemOrphanEscape(since)}` : ""}</div>
        </div>
        <div class="candidate-actions">
          <button class="btn secondary" data-action="preview" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Verwendungen prüfen" : "Check references"}</button>
          <button class="btn secondary" data-action="protect" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Schützen" : "Protect"}</button>
          <button class="btn danger" data-action="cleanup" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Bereinigen" : "Clean up"}</button>
        </div>
      </article>`;
  }

  _renderPreview(de) {
    const p = this._preview;
    if (!p) return "";
    const entity = p.entity || {};
    const references = Array.isArray(p.references) ? p.references : [];
    const errors = Array.isArray(p.reference_check_errors) ? p.reference_check_errors : [];

    return `
      <div class="dialog-shell preview-shell">
        <header class="header">
          <button class="icon-btn" data-action="back-preview" title="${de ? "Zurück" : "Back"}">←</button>
          <div>
            <div class="eyebrow">${de ? "FRISCHE PRÜFUNG" : "FRESH CHECK"}</div>
            <h2>${aemOrphanEscape(entity.name || entity.entity_id || "")}</h2>
            <p><code>${aemOrphanEscape(entity.entity_id || "")}</code></p>
          </div>
          <button class="icon-btn" data-action="close" title="${de ? "Schließen" : "Close"}">✕</button>
        </header>
        <main class="content">
          <section class="info-grid">
            <div><span>${de ? "Quelle" : "Source"}</span><strong>${aemOrphanEscape(aemOrphanSourceLabel(entity.source_reason, de))}</strong></div>
            <div><span>${de ? "Nicht verfügbar seit" : "Unavailable for"}</span><strong>${aemOrphanEscape(aemOrphanFormatAge(entity.unavailable_seconds, de))}</strong></div>
            <div><span>${de ? "Gefundene Verwendungen" : "References found"}</span><strong>${references.length}</strong></div>
            <div><span>${de ? "Prüfung" : "Check"}</span><strong>${p.reference_check_complete ? (de ? "unterstützte Bereiche vollständig" : "supported scopes complete") : (de ? "unvollständig" : "incomplete")}</strong></div>
          </section>

          ${p.safe_cleanup_candidate ? `<div class="notice success"><strong>${de ? "Sicherer Bereinigungskandidat" : "Safe cleanup candidate"}</strong><span>${de ? "In allen von AEM unterstützten Bereichen wurde keine Verwendung gefunden und die Quelle stellt die Entität nicht mehr bereit." : "No references were found in AEM-supported scopes and the source no longer provides the entity."}</span></div>` : ""}
          ${p.source_still_may_recreate ? `<div class="notice warning"><strong>${de ? "Quelle könnte die Entität erneut anlegen" : "Source may recreate the entity"}</strong><span>${de ? "AEM hat keine starke Bestätigung, dass die Quelle endgültig verschwunden ist. Nach dem Löschen kann die Entität wieder erscheinen." : "AEM has no strong confirmation that the source is permanently gone. The entity may reappear after deletion."}</span></div>` : ""}
          ${!p.reference_check_complete ? `<div class="notice danger"><strong>${de ? "Referenzprüfung unvollständig" : "Reference check incomplete"}</strong><span>${de ? "AEM konnte nicht jeden Bereich zuverlässig prüfen. Die Entität wird deshalb niemals als sicher bezeichnet." : "AEM could not reliably check every scope, so the entity is not considered safe."}</span></div>` : ""}

          <section class="section">
            <h3>${de ? "Verwendungen" : "References"}</h3>
            ${references.length ? `<div class="reference-list">${references.map((ref, index) => `
              <div class="reference-row">
                <span class="reference-icon">${aemOrphanEscape(aemOrphanReferenceTypeLabel(ref.type, de).slice(0, 1))}</span>
                <span class="reference-copy">
                  <strong>${aemOrphanEscape(ref.name || ref.id || ref.entity_id)}</strong>
                  <small>${aemOrphanEscape(aemOrphanReferenceTypeLabel(ref.type, de))}${ref.context ? ` · ${aemOrphanEscape(ref.context)}` : ""}</small>
                </span>
                ${(ref.url || ref.entity_id) ? `<button class="btn secondary" data-action="open-reference" data-index="${index}">${de ? "Öffnen" : "Open"}</button>` : ""}
              </div>`).join("")}</div>` : `<div class="empty">${de ? "Keine Verwendung in den zuverlässig geprüften Bereichen gefunden." : "No references were found in the reliably checked scopes."}</div>`}
          </section>

          ${errors.length ? `<section class="section"><h3>${de ? "Nicht vollständig prüfbar" : "Could not be fully checked"}</h3><div class="error-list">${errors.map((err) => `<div><strong>${aemOrphanEscape(err.scope)}</strong><span>${aemOrphanEscape(err.message)}</span></div>`).join("")}</div></section>` : ""}

          ${this._cleanupIntent ? `<section class="danger-zone">
            <h3>${de ? "Entität entfernen" : "Remove entity"}</h3>
            <p>${de ? "AEM prüft beim endgültigen Klick serverseitig noch einmal. Es wird niemals automatisch gelöscht." : "AEM checks again on the server when you confirm. Nothing is ever deleted automatically."}</p>
            ${p.requires_reference_confirmation ? `<label><input id="confirm-references" type="checkbox"> <span>${de ? "Ich habe die oben gefundenen Verwendungen gesehen und möchte trotzdem fortfahren." : "I reviewed the references above and still want to continue."}</span></label>` : ""}
            ${p.requires_incomplete_confirmation ? `<label><input id="confirm-incomplete" type="checkbox"> <span>${de ? "Mir ist bewusst, dass die Referenzprüfung unvollständig war." : "I understand that the reference check was incomplete."}</span></label>` : ""}
            ${p.requires_source_confirmation ? `<label><input id="confirm-source" type="checkbox"> <span>${de ? "Mir ist bewusst, dass die Quelle die Entität erneut anlegen könnte." : "I understand that the source may recreate the entity."}</span></label>` : ""}
            <label><input id="confirm-delete" type="checkbox"> <span>${de ? "Ich möchte diesen Registry-Eintrag jetzt wirklich entfernen." : "I really want to remove this registry entry now."}</span></label>
            <button class="btn danger large" data-action="delete-confirmed">${de ? "Entität endgültig bereinigen" : "Permanently clean up entity"}</button>
          </section>` : ""}
        </main>
      </div>`;
  }

  _render() {
    const de = aemOrphanIsGerman(this.hass);
    if (!this.shadowRoot) return;
    if (this._preview) {
      this.shadowRoot.innerHTML = `${this._styles()}<div class="backdrop">${this._renderPreview(de)}</div>`;
      return;
    }

    const data = this._data || {};
    const summary = data.summary || {};
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const observing = Array.isArray(data.observing) ? data.observing : [];
    const protectedItems = Array.isArray(data.protected) ? data.protected : [];
    const history = Array.isArray(data.history) ? data.history : [];

    this.shadowRoot.innerHTML = `${this._styles()}
      <div class="backdrop">
        <div class="dialog-shell">
          <header class="header">
            <div>
              <div class="eyebrow">AEM ${AEM_ORPHAN_UI_VERSION}</div>
              <h2>${de ? "Verwaiste Entitäten · BETA" : "Orphaned entities · BETA"}</h2>
              <p>${de ? "AEM beobachtet dauerhaft nicht verfügbare Entitäten. Gelöscht wird ausschließlich nach deiner ausdrücklichen Bestätigung." : "AEM observes persistently unavailable entities. Deletion only happens after your explicit confirmation."}</p>
            </div>
            <button class="icon-btn" data-action="close" title="${de ? "Schließen" : "Close"}">✕</button>
          </header>
          <main class="content">
            ${this._error ? `<div class="notice danger"><strong>${de ? "Fehler" : "Error"}</strong><span>${aemOrphanEscape(this._error)}</span></div>` : ""}
            ${this._message ? `<div class="notice success"><span>${aemOrphanEscape(this._message)}</span></div>` : ""}
            ${this._loading ? `<div class="loading">${de ? "Daten werden geladen …" : "Loading …"}</div>` : `
              <div class="notice info"><span>${de ? "Wichtig: Die Ausfallzeit vor Installation dieser Version kann AEM nicht zuverlässig rückwirkend kennen. Die dauerhafte Beobachtung beginnt deshalb mit den von AEM selbst gesehenen Zuständen." : "Important: AEM cannot reliably reconstruct downtime from before this version was installed. Persistent observation therefore starts with states AEM has actually seen."}</span></div>

              <section class="summary-grid">
                <div><strong>${Number(summary.candidates || 0)}</strong><span>${de ? "Bereinigungskandidaten" : "cleanup candidates"}</span></div>
                <div><strong>${Number(summary.observing || 0)}</strong><span>${de ? "in Beobachtung" : "being observed"}</span></div>
                <div><strong>${Number(summary.protected || 0)}</strong><span>${de ? "geschützt" : "protected"}</span></div>
              </section>

              <section class="section">
                <div class="section-title"><h3>${de ? "Kandidaten" : "Candidates"}</h3><button class="btn secondary" data-action="refresh">${de ? "Jetzt prüfen" : "Check now"}</button></div>
                ${candidates.length ? `<div class="candidate-list">${candidates.map((item) => this._renderCandidate(item, de)).join("")}</div>` : `<div class="empty">${de ? "Aktuell gibt es keinen Kandidaten, der die eingestellte Frist erreicht hat." : "No candidate has reached the configured age yet."}</div>`}
              </section>

              ${observing.length ? `<section class="section"><h3>${de ? "Noch in Beobachtung" : "Still being observed"}</h3><div class="compact-list">${observing.map((item) => `<div><strong>${aemOrphanEscape(item.name || item.entity_id)}</strong><code>${aemOrphanEscape(item.entity_id)}</code><span>${aemOrphanEscape(aemOrphanSourceLabel(item.source_reason, de))} · ${aemOrphanEscape(aemOrphanFormatAge(item.unavailable_seconds, de))}</span></div>`).join("")}</div></section>` : ""}

              ${protectedItems.length ? `<section class="section"><h3>${de ? "Geschützt" : "Protected"}</h3><div class="compact-list">${protectedItems.map((item) => `<div class="protected-row"><span><strong>${aemOrphanEscape(item.name || item.entity_id)}</strong><code>${aemOrphanEscape(item.entity_id)}</code></span><button class="btn secondary" data-action="unprotect" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Schutz aufheben" : "Unprotect"}</button></div>`).join("")}</div></section>` : ""}

              ${history.length ? `<section class="section"><h3>${de ? "Bereinigungsverlauf" : "Cleanup history"}</h3><div class="history-list">${history.map((item) => `<div><strong>${aemOrphanEscape(item.name || item.entity_id)}</strong><code>${aemOrphanEscape(item.entity_id)}</code><span>${aemOrphanEscape(aemOrphanFormatDate(item.removed_at, this.hass))} · ${Number(item.reference_count || 0)} ${de ? "Verwendungen" : "references"}</span></div>`).join("")}</div></section>` : ""}
            `}
          </main>
        </div>
      </div>`;
  }

  _styles() {
    return `<style>
      :host{font-family:var(--paper-font-body1_-_font-family,Roboto,Arial,sans-serif);color:var(--primary-text-color);}
      *{box-sizing:border-box}.backdrop{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:24px}.dialog-shell{width:min(1050px,96vw);max-height:92vh;overflow:hidden;background:var(--card-background-color,#1f1f1f);border:1px solid var(--divider-color,rgba(255,255,255,.12));border-radius:20px;box-shadow:0 24px 80px rgba(0,0,0,.45);display:flex;flex-direction:column}.preview-shell{width:min(980px,96vw)}.header{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;padding:22px 24px;border-bottom:1px solid var(--divider-color,rgba(255,255,255,.1))}.preview-shell .header{grid-template-columns:auto 1fr auto}.header h2{margin:3px 0 6px;font-size:25px}.header p{margin:0;color:var(--secondary-text-color);font-size:13px}.eyebrow{font-size:11px;color:var(--secondary-text-color);font-weight:700;letter-spacing:.04em}.content{padding:18px 22px 26px;overflow:auto}.icon-btn{border:0;border-radius:12px;background:var(--secondary-background-color,rgba(255,255,255,.08));color:var(--primary-text-color);font-size:19px;min-width:42px;height:42px;cursor:pointer}.settings-card,.candidate-card,.reference-row,.compact-list>div,.history-list>div{border:1px solid var(--divider-color,rgba(255,255,255,.1));background:var(--secondary-background-color,rgba(255,255,255,.035));border-radius:14px}.settings-card{display:flex;gap:18px;justify-content:space-between;align-items:center;padding:14px 16px;margin-bottom:14px}.settings-card>div:first-child{display:flex;flex-direction:column;gap:4px}.settings-card small,.candidate-meta,.reference-copy small,.compact-list span,.history-list span{color:var(--secondary-text-color);font-size:12px}.days-control{display:flex;align-items:center;gap:8px}.days-control input{width:92px;padding:9px 10px;border:1px solid var(--divider-color);border-radius:10px;background:var(--primary-background-color);color:var(--primary-text-color);appearance:textfield;-moz-appearance:textfield}.days-control input::-webkit-outer-spin-button,.days-control input::-webkit-inner-spin-button{appearance:none;-webkit-appearance:none;margin:0}.btn{border:0;border-radius:10px;padding:9px 12px;cursor:pointer;font-weight:600}.btn:disabled{opacity:.45;cursor:default}.secondary{background:var(--secondary-background-color,#333);color:var(--primary-text-color)}.danger{background:var(--error-color,#d64b4b);color:#fff}.large{padding:11px 16px}.notice{display:flex;flex-direction:column;gap:3px;border-radius:12px;padding:11px 13px;margin:10px 0;border-left:3px solid}.notice.info{background:rgba(3,169,244,.08);border-color:var(--info-color,#03a9f4)}.notice.success{background:rgba(76,175,80,.1);border-color:var(--success-color,#4caf50)}.notice.warning{background:rgba(255,152,0,.11);border-color:var(--warning-color,#ff9800)}.notice.danger{background:rgba(244,67,54,.11);border-color:var(--error-color,#f44336)}.notice span{font-size:13px;color:var(--secondary-text-color)}.summary-grid,.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.info-grid{grid-template-columns:repeat(4,1fr)}.summary-grid>div,.info-grid>div{padding:12px 14px;border:1px solid var(--divider-color);border-radius:12px;display:flex;flex-direction:column;gap:3px}.summary-grid strong{font-size:23px}.summary-grid span,.info-grid span{font-size:11px;color:var(--secondary-text-color)}.info-grid strong{font-size:13px}.section{margin-top:20px}.section h3{margin:0 0 10px;font-size:16px}.section-title{display:flex;justify-content:space-between;align-items:center}.candidate-list,.reference-list,.compact-list,.history-list{display:flex;flex-direction:column;gap:9px}.candidate-card{display:flex;gap:14px;justify-content:space-between;align-items:center;padding:13px}.candidate-main{min-width:0}.candidate-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.candidate-main code,.compact-list code,.history-list code{display:block;font-size:11px;color:var(--secondary-text-color);margin:3px 0}.badge{font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid}.badge.warning{color:var(--warning-color,#ff9800);border-color:var(--warning-color,#ff9800)}.candidate-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.reference-row{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:11px 12px}.reference-icon{width:30px;height:30px;border-radius:9px;background:var(--primary-background-color);display:grid;place-items:center;font-weight:700}.reference-copy{min-width:0;display:flex;flex-direction:column;gap:2px}.reference-copy small{white-space:normal;word-break:break-word}.compact-list>div,.history-list>div{padding:10px 12px;display:flex;flex-direction:column}.protected-row{flex-direction:row!important;justify-content:space-between;align-items:center;gap:10px}.error-list{display:flex;flex-direction:column;gap:8px}.error-list>div{padding:10px 12px;border-radius:10px;background:rgba(244,67,54,.08);display:flex;flex-direction:column;gap:3px}.error-list span{font-size:12px;color:var(--secondary-text-color)}.danger-zone{margin-top:22px;padding:16px;border:1px solid var(--error-color,#f44336);border-radius:14px;background:rgba(244,67,54,.06)}.danger-zone h3{margin:0 0 5px}.danger-zone p{font-size:12px;color:var(--secondary-text-color)}.danger-zone label{display:flex;gap:9px;align-items:flex-start;margin:10px 0;font-size:13px}.danger-zone input{margin-top:2px}.danger-zone .btn{margin-top:8px}.empty,.loading{padding:18px;border:1px dashed var(--divider-color);border-radius:12px;color:var(--secondary-text-color);font-size:13px;text-align:center}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
      @media(max-width:760px){.backdrop{padding:8px}.dialog-shell{max-height:97vh;border-radius:14px}.header{padding:16px}.content{padding:14px}.settings-card,.candidate-card{align-items:stretch;flex-direction:column}.days-control{flex-wrap:wrap}.summary-grid,.info-grid{grid-template-columns:1fr 1fr}.candidate-actions{justify-content:flex-start}.reference-row{grid-template-columns:auto 1fr}.reference-row .btn{grid-column:2}.protected-row{align-items:flex-start!important;flex-direction:column!important}}
    </style>`;
  }
}
if (!customElements.get("aem-orphan-dialog")) customElements.define("aem-orphan-dialog", AEMOrphanDialog);



function aemOrphanCandidateMap(data) {
  const map = new Map();
  for (const item of Array.isArray(data?.candidates) ? data.candidates : []) {
    if (item?.entity_id) map.set(item.entity_id, item);
  }
  for (const item of Array.isArray(data?.protected) ? data.protected : []) {
    if (item?.candidate && item?.entity_id && !map.has(item.entity_id)) map.set(item.entity_id, item);
  }
  return map;
}

function aemOrphanPageCandidateMarkup(item, de, hass) {
  const source = aemOrphanSourceLabel(item.source_reason, de);
  const age = aemOrphanFormatAge(item.unavailable_seconds, de);
  const since = aemOrphanFormatDate(item.unavailable_since, hass);
  const badge = item.status === "orphan_candidate"
    ? (de ? "Verwaist-Kandidat" : "Orphan candidate")
    : (de ? "Offline-Kandidat" : "Offline candidate");
  return `
    <article class="aem-orphan-page-candidate">
      <div class="aem-orphan-page-candidate-main">
        <div class="aem-orphan-page-title-row">
          <strong>${aemOrphanEscape(item.name || item.entity_id)}</strong>
          <span class="aem-orphan-page-badge">${aemOrphanEscape(badge)}</span>
        </div>
        <code>${aemOrphanEscape(item.entity_id)}</code>
        <div class="aem-orphan-page-meta">${aemOrphanEscape(source)} · ${de ? "seit" : "for"} ${aemOrphanEscape(age)}${since ? ` · ${de ? "Beginn" : "since"}: ${aemOrphanEscape(since)}` : ""}</div>
      </div>
      <div class="aem-orphan-page-actions">
        <button class="aem-orphan-page-btn secondary" data-orphan-action="preview" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Verwendungen prüfen" : "Check references"}</button>
        <button class="aem-orphan-page-btn secondary" data-orphan-action="protect" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Schützen" : "Protect"}</button>
        <button class="aem-orphan-page-btn danger" data-orphan-action="cleanup" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Bereinigen" : "Clean up"}</button>
      </div>
    </article>`;
}

function aemOrphanPageMarkup(instance) {
  const de = aemOrphanIsGerman(instance?._hass);
  const data = instance?.__aemOrphanData || {};
  const summary = data.summary || {};
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const observing = Array.isArray(data.observing) ? data.observing : [];
  const protectedItems = Array.isArray(data.protected) ? data.protected : [];
  const history = Array.isArray(data.history) ? data.history : [];
  const error = instance?.__aemOrphanPageError || "";
  const message = instance?.__aemOrphanPageMessage || "";
  const loading = Boolean(instance?.__aemOrphanPageBusy);
  return `
    <div class="aem-orphan-page-view">
      <div class="aem-orphan-page-head">
        <div class="aem-orphan-page-head-copy">
          <h2>${de ? "Verwaiste Entitäten · BETA" : "Orphaned entities · BETA"}</h2>
          <p>${de ? "Hier findest du Entitäten, die die eingestellte Ausfallzeit erreicht haben oder nicht mehr von ihrer Quelle bereitgestellt werden." : "Entities that reached the configured downtime or are no longer provided by their source appear here."}</p>
        </div>
      </div>
      ${error ? `<div class="aem-orphan-page-notice danger"><strong>${de ? "Fehler" : "Error"}</strong><span>${aemOrphanEscape(error)}</span></div>` : ""}
      ${message ? `<div class="aem-orphan-page-notice success"><span>${aemOrphanEscape(message)}</span></div>` : ""}
      ${loading ? `<div class="aem-orphan-page-loading">${de ? "Daten werden geladen …" : "Loading …"}</div>` : ""}
      <div class="aem-orphan-page-notice info"><span>${de ? "AEM löscht niemals automatisch. Vor jeder Bereinigung werden die Verwendungen erneut frisch geprüft." : "AEM never deletes automatically. References are checked again immediately before every cleanup."}</span></div>
      <section class="aem-orphan-page-summary">
        <div><strong>${Number(summary.candidates || 0)}</strong><span>${de ? "Bereinigungskandidaten" : "cleanup candidates"}</span></div>
        <div><strong>${Number(summary.observing || 0)}</strong><span>${de ? "in Beobachtung" : "being observed"}</span></div>
        <div><strong>${Number(summary.protected || 0)}</strong><span>${de ? "geschützt" : "protected"}</span></div>
      </section>
      <section class="aem-orphan-page-section">
        <div class="aem-orphan-page-section-title"><h3>${de ? "Kandidaten" : "Candidates"}</h3><button class="aem-orphan-page-btn secondary aem-orphan-page-refresh" type="button">${de ? "Jetzt prüfen" : "Check now"}</button></div>
        ${candidates.length ? `<div class="aem-orphan-page-list">${candidates.map((item) => aemOrphanPageCandidateMarkup(item, de, instance?._hass)).join("")}</div>` : `<div class="aem-orphan-page-empty">${de ? "Aktuell gibt es keinen Kandidaten, der die eingestellte Frist erreicht hat." : "No candidate has reached the configured age yet."}</div>`}
      </section>
      ${observing.length ? `<section class="aem-orphan-page-section"><h3>${de ? "Noch in Beobachtung" : "Still being observed"}</h3><div class="aem-orphan-page-compact">${observing.map((item) => `<div><strong>${aemOrphanEscape(item.name || item.entity_id)}</strong><code>${aemOrphanEscape(item.entity_id)}</code><span>${aemOrphanEscape(aemOrphanSourceLabel(item.source_reason, de))} · ${aemOrphanEscape(aemOrphanFormatAge(item.unavailable_seconds, de))}</span></div>`).join("")}</div></section>` : ""}
      ${protectedItems.length ? `<section class="aem-orphan-page-section"><h3>${de ? "Geschützt" : "Protected"}</h3><div class="aem-orphan-page-compact">${protectedItems.map((item) => `<div class="aem-orphan-page-protected"><span><strong>${aemOrphanEscape(item.name || item.entity_id)}</strong><code>${aemOrphanEscape(item.entity_id)}</code></span><button class="aem-orphan-page-btn secondary" data-orphan-action="unprotect" data-entity-id="${aemOrphanEscape(item.entity_id)}">${de ? "Schutz aufheben" : "Unprotect"}</button></div>`).join("")}</div></section>` : ""}
      ${history.length ? `<section class="aem-orphan-page-section"><h3>${de ? "Bereinigungsverlauf" : "Cleanup history"}</h3><div class="aem-orphan-page-compact">${history.map((item) => `<div><strong>${aemOrphanEscape(item.name || item.entity_id)}</strong><code>${aemOrphanEscape(item.entity_id)}</code><span>${aemOrphanEscape(aemOrphanFormatDate(item.removed_at, instance?._hass))} · ${Number(item.reference_count || 0)} ${de ? "Verwendungen" : "references"}</span></div>`).join("")}</div></section>` : ""}
    </div>`;
}

function aemOrphanClosePage(instance) {
  instance.__aemOrphanPageOpen = false;
  instance.__aemOrphanPageError = "";
  instance.__aemOrphanPageMessage = "";
  const root = instance?.shadowRoot;
  root?.host?.classList.remove("aem-orphan-page-open");
  root?.querySelector(".aem-orphan-page-host")?.remove();
  aemOrphanRenderStatusTile(instance);
}

function aemOrphanOpenPage(instance) {
  if (!instance?.shadowRoot) return;
  instance.__aemOrphanPageOpen = true;
  instance.__aemOrphanPageError = "";
  instance.__aemOrphanPageMessage = "";
  aemOrphanRenderStatusTile(instance);
  aemOrphanRenderInlinePage(instance);
}

function aemOrphanBindInlinePage(instance, host) {
  host.querySelector(".aem-orphan-page-refresh")?.addEventListener("click", async () => {
    instance.__aemOrphanPageBusy = true;
    instance.__aemOrphanPageError = "";
    instance.__aemOrphanPageMessage = "";
    aemOrphanRenderInlinePage(instance);
    try {
      await aemOrphanRefreshData(instance, true);
    } catch (err) {
      instance.__aemOrphanPageError = err?.message || String(err);
    } finally {
      instance.__aemOrphanPageBusy = false;
      aemOrphanRenderInlinePage(instance);
    }
  });
  host.querySelectorAll("[data-orphan-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.orphanAction;
      const entityId = button.dataset.entityId;
      if (!action || !entityId) return;
      if (action === "preview" || action === "cleanup") {
        aemOrphanOpenDialog(instance, { entityId, cleanupIntent: action === "cleanup" });
        return;
      }
      instance.__aemOrphanPageBusy = true;
      instance.__aemOrphanPageError = "";
      try {
        await aemOrphanCallWS(instance._hass, {
          type: "assist_entity_manager/orphans/protect",
          entity_id: entityId,
          protected: action === "protect",
        });
        const de = aemOrphanIsGerman(instance._hass);
        instance.__aemOrphanPageMessage = action === "protect" ? (de ? "Entität geschützt." : "Entity protected.") : (de ? "Schutz aufgehoben." : "Protection removed.");
        await aemOrphanRefreshData(instance, true);
      } catch (err) {
        instance.__aemOrphanPageError = err?.message || String(err);
      } finally {
        instance.__aemOrphanPageBusy = false;
        aemOrphanRenderInlinePage(instance);
      }
    });
  });
}

function aemOrphanBindTopNavigation(instance) {
  const root = instance?.shadowRoot;
  const tabs = root?.querySelector(".status-tabs");
  if (!tabs || tabs.dataset.aemOrphanNavigationBound === "1") return;
  tabs.dataset.aemOrphanNavigationBound = "1";
  tabs.addEventListener("click", (event) => {
    if (!instance.__aemOrphanPageOpen) return;
    const target = event.target?.closest?.(".status-tab, .conflict-tab");
    if (!target || target.classList.contains("aem-orphan-status-tab")) return;
    // Leave the orphan view before AEM's own tab handler applies its normal
    // status/conflict navigation. We deliberately do not prevent the click.
    instance.__aemOrphanPageOpen = false;
    instance.__aemOrphanPageError = "";
    instance.__aemOrphanPageMessage = "";
    root.host?.classList.remove("aem-orphan-page-open");
    root.querySelector(".aem-orphan-page-host")?.remove();
  }, true);
}

function aemOrphanRenderInlinePage(instance) {
  const root = instance?.shadowRoot;
  if (!root) return;
  if (!instance.__aemOrphanPageOpen) {
    root.host?.classList.remove("aem-orphan-page-open");
    root.querySelector(".aem-orphan-page-host")?.remove();
    return;
  }
  const tabs = root.querySelector(".status-tabs");
  if (!tabs) return;
  root.host?.classList.add("aem-orphan-page-open");
  let host = root.querySelector(".aem-orphan-page-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "aem-orphan-page-host";
    tabs.insertAdjacentElement("afterend", host);
  }
  host.innerHTML = aemOrphanPageMarkup(instance);
  aemOrphanBindInlinePage(instance, host);
}

function aemOrphanDecorateEntityRows(instance) {
  const root = instance?.shadowRoot;
  if (!root) return;
  const map = aemOrphanCandidateMap(instance.__aemOrphanData);
  root.querySelectorAll(".entity-row[data-entity]").forEach((row) => {
    const entityId = row.dataset.entity;
    const item = map.get(entityId);
    const line = row.querySelector(".name-line");
    const existing = line?.querySelector(".aem-orphan-entity-chip");
    if (!item) {
      existing?.remove();
      row.classList.remove("aem-orphan-entity-row");
      return;
    }
    row.classList.add("aem-orphan-entity-row");
    if (!existing && line) {
      const chip = document.createElement("span");
      chip.className = "quality-chip aem-orphan-entity-chip";
      chip.title = aemOrphanSourceLabel(item.source_reason, aemOrphanIsGerman(instance._hass));
      chip.innerHTML = `<ha-icon icon="mdi:link-off"></ha-icon>${aemOrphanIsGerman(instance._hass) ? "Verwaist" : "Orphaned"}`;
      line.appendChild(chip);
    }
  });
}

function aemOrphanDecorateDetails(instance) {
  const root = instance?.shadowRoot;
  if (!root || !instance?._detailEntityId) return;
  const item = aemOrphanCandidateMap(instance.__aemOrphanData).get(instance._detailEntityId);
  root.querySelector(".aem-orphan-detail-notice")?.remove();
  root.querySelector(".aem-orphan-detail-open")?.remove();
  if (!item) return;
  const de = aemOrphanIsGerman(instance._hass);
  const header = root.querySelector(".detail-header");
  if (header) {
    const notice = document.createElement("div");
    notice.className = "aem-orphan-detail-notice";
    notice.innerHTML = `<ha-icon icon="mdi:link-off"></ha-icon><div><strong>${de ? "Als verwaist erkannt" : "Detected as orphaned"}</strong><span>${aemOrphanEscape(aemOrphanSourceLabel(item.source_reason, de))} · ${de ? "seit" : "for"} ${aemOrphanEscape(aemOrphanFormatAge(item.unavailable_seconds, de))}</span></div>`;
    header.insertAdjacentElement("afterend", notice);
  }
  const footer = root.querySelector(".detail-footer");
  if (footer) {
    const button = document.createElement("button");
    button.className = "btn secondary aem-orphan-detail-open";
    button.type = "button";
    button.innerHTML = `<ha-icon icon="mdi:link-off"></ha-icon>${de ? "Verwaiste Entitäten öffnen" : "Open orphaned entities"}`;
    button.addEventListener("click", () => {
      instance.__aemOrphanPageOpen = true;
      if (typeof instance._closeDetails === "function") instance._closeDetails();
      else {
        instance._detailEntityId = "";
        instance._render?.();
      }
      queueMicrotask(() => aemOrphanRenderInlinePage(instance));
    });
    footer.insertAdjacentElement("beforebegin", button);
  }
}

function aemOrphanOpenDialog(instance, options = {}) {
  document.querySelectorAll("aem-orphan-dialog").forEach((dialog) => dialog.remove());
  const dialog = document.createElement("aem-orphan-dialog");
  dialog.hass = instance?._hass;
  dialog.ownerInstance = instance || null;
  if (options?.entityId) dialog.initialPreview = { entityId: options.entityId, cleanupIntent: Boolean(options.cleanupIntent) };
  document.body.appendChild(dialog);
}

function aemOrphanDetectedCount(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates.length : 0;
  const protectedCandidates = Array.isArray(data?.protected)
    ? data.protected.filter((item) => Boolean(item?.candidate)).length
    : 0;
  return candidates + protectedCandidates;
}

function aemOrphanInstallMainStyle(instance) {
  const root = instance?.shadowRoot;
  if (!root || root.querySelector("style[data-aem-orphan-main-style]")) return;
  const style = document.createElement("style");
  style.dataset.aemOrphanMainStyle = "1";
  style.textContent = `
    .aem-orphan-status-tab{border-color:color-mix(in srgb,var(--warning-color,#ff9800) 38%,var(--divider-color))!important}
    .aem-orphan-status-tab:hover{border-color:color-mix(in srgb,var(--warning-color,#ff9800) 64%,var(--divider-color))!important}
    .aem-orphan-status-tab .tab-icon.orphan{color:var(--warning-color,#ff9800);background:color-mix(in srgb,var(--warning-color,#ff9800) 12%,transparent)}
    .aem-orphan-status-tab .aem-orphan-count{color:var(--warning-color,#ff9800);font-weight:700}
    .aem-orphan-settings-row{display:flex;align-items:center;gap:14px;padding:14px 16px;margin-top:12px;border:1px solid var(--divider-color,rgba(255,255,255,.1));border-radius:14px;background:var(--secondary-background-color,rgba(255,255,255,.03))}
    .aem-orphan-settings-icon{width:40px;height:40px;border-radius:12px;background:rgba(255,152,0,.12);display:grid;place-items:center;color:var(--warning-color,#ff9800);flex:0 0 auto}
    .aem-orphan-settings-copy{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}.aem-orphan-settings-copy small{color:var(--secondary-text-color);font-size:12px}
    .aem-orphan-settings-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}.aem-orphan-settings-controls input{width:78px;padding:8px;border:1px solid var(--divider-color);border-radius:9px;background:var(--primary-background-color);color:var(--primary-text-color);appearance:textfield;-moz-appearance:textfield}.aem-orphan-settings-controls input::-webkit-outer-spin-button,.aem-orphan-settings-controls input::-webkit-inner-spin-button{appearance:none;-webkit-appearance:none;margin:0}
    .aem-orphan-settings-controls button{border:0;border-radius:9px;padding:8px 10px;cursor:pointer;background:var(--primary-color,#03a9f4);color:var(--text-primary-color,#fff);font-weight:600}.aem-orphan-settings-controls button:disabled{opacity:.5;cursor:default}
    .aem-orphan-settings-message{font-size:11px;color:var(--success-color,#4caf50)}.aem-orphan-settings-message.error{color:var(--error-color,#f44336)}
    .aem-orphan-entity-chip{color:var(--warning-color,#ff9800)!important;border-color:color-mix(in srgb,var(--warning-color,#ff9800) 55%,transparent)!important;background:color-mix(in srgb,var(--warning-color,#ff9800) 10%,transparent)!important}.aem-orphan-entity-chip ha-icon{color:var(--warning-color,#ff9800)!important}
    .aem-orphan-detail-notice{margin:14px 20px 0;padding:12px 14px;border:1px solid color-mix(in srgb,var(--warning-color,#ff9800) 45%,var(--divider-color));border-radius:13px;background:color-mix(in srgb,var(--warning-color,#ff9800) 8%,transparent);display:flex;align-items:center;gap:11px}.aem-orphan-detail-notice>ha-icon{color:var(--warning-color,#ff9800);font-size:24px}.aem-orphan-detail-notice div{display:flex;flex-direction:column;gap:3px}.aem-orphan-detail-notice span{font-size:12px;color:var(--secondary-text-color)}.aem-orphan-detail-open{margin:16px 20px 4px;width:calc(100% - 40px);justify-content:center;display:flex!important;align-items:center;gap:8px;border-color:color-mix(in srgb,var(--warning-color,#ff9800) 45%,var(--divider-color))!important}
    :host(.aem-orphan-page-open) .status-tabs ~ *:not(.aem-orphan-page-host){display:none!important}:host(.aem-orphan-page-open) .aem-orphan-page-host{display:block!important}.aem-orphan-page-host{margin-top:18px}.aem-orphan-page-view{display:flex;flex-direction:column;gap:14px}.aem-orphan-page-head{display:flex;align-items:flex-start;justify-content:flex-start;gap:20px;padding:8px 18px 12px}.aem-orphan-page-head-copy{max-width:820px}.aem-orphan-page-head h2{margin:0 0 7px;font-size:28px;line-height:1.15}.aem-orphan-page-head p{margin:0;color:var(--secondary-text-color);max-width:760px}.aem-orphan-page-btn{border:1px solid var(--divider-color);border-radius:10px;padding:9px 12px;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;gap:7px}.aem-orphan-page-btn.secondary{background:var(--secondary-background-color,#333);color:var(--primary-text-color)}.aem-orphan-page-btn.danger{background:var(--error-color,#d64b4b);border-color:var(--error-color,#d64b4b);color:#fff}.aem-orphan-page-notice{display:flex;flex-direction:column;gap:3px;border-radius:12px;padding:11px 13px;border-left:3px solid}.aem-orphan-page-notice.info{background:rgba(3,169,244,.08);border-color:var(--info-color,#03a9f4)}.aem-orphan-page-notice.success{background:rgba(76,175,80,.1);border-color:var(--success-color,#4caf50)}.aem-orphan-page-notice.danger{background:rgba(244,67,54,.11);border-color:var(--error-color,#f44336)}.aem-orphan-page-notice span{font-size:13px;color:var(--secondary-text-color)}.aem-orphan-page-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.aem-orphan-page-summary>div{padding:14px;border:1px solid var(--divider-color);border-radius:13px;background:var(--secondary-background-color,rgba(255,255,255,.025));display:flex;flex-direction:column;gap:3px}.aem-orphan-page-summary strong{font-size:24px}.aem-orphan-page-summary span,.aem-orphan-page-meta,.aem-orphan-page-compact span{font-size:12px;color:var(--secondary-text-color)}.aem-orphan-page-section{margin-top:4px}.aem-orphan-page-section h3{margin:0 0 10px}.aem-orphan-page-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.aem-orphan-page-list,.aem-orphan-page-compact{display:flex;flex-direction:column;gap:9px}.aem-orphan-page-candidate,.aem-orphan-page-compact>div{padding:13px;border:1px solid var(--divider-color);border-radius:14px;background:var(--secondary-background-color,rgba(255,255,255,.03))}.aem-orphan-page-candidate{display:flex;align-items:center;justify-content:space-between;gap:14px}.aem-orphan-page-candidate-main{min-width:0}.aem-orphan-page-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.aem-orphan-page-candidate code,.aem-orphan-page-compact code{display:block;margin:3px 0;font-size:11px;color:var(--secondary-text-color)}.aem-orphan-page-badge{font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid var(--warning-color,#ff9800);color:var(--warning-color,#ff9800)}.aem-orphan-page-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.aem-orphan-page-protected{display:flex!important;align-items:center;justify-content:space-between;gap:12px}.aem-orphan-page-empty,.aem-orphan-page-loading{padding:18px;border:1px dashed var(--divider-color);border-radius:12px;color:var(--secondary-text-color);font-size:13px;text-align:center}
    @media(max-width:700px){.aem-orphan-settings-row{align-items:flex-start;flex-wrap:wrap}.aem-orphan-settings-controls{width:100%;justify-content:flex-start;margin-left:54px}.aem-orphan-page-head,.aem-orphan-page-candidate{flex-direction:column;align-items:stretch}.aem-orphan-page-summary{grid-template-columns:1fr}.aem-orphan-page-actions{justify-content:flex-start}.aem-orphan-detail-open{margin-left:14px;margin-right:14px;width:calc(100% - 28px)}}
  `;
  root.appendChild(style);
}

function aemOrphanRenderStatusTile(instance) {
  const root = instance?.shadowRoot;
  if (!root || !instance?._hass?.user?.is_admin) return;
  const tabs = root.querySelector(".status-tabs");
  if (!tabs) return;
  const count = aemOrphanDetectedCount(instance.__aemOrphanData);
  const existing = tabs.querySelector(".aem-orphan-status-tab");
  if (count <= 0) {
    existing?.remove();
    return;
  }

  const de = aemOrphanIsGerman(instance?._hass);
  const label = count === 1
    ? (de ? "1 Kandidat erkannt" : "1 candidate detected")
    : (de ? `${count} Kandidaten erkannt` : `${count} candidates detected`);
  const button = existing || document.createElement("button");
  button.className = `status-tab aem-orphan-status-tab ${instance?.__aemOrphanPageOpen ? "active" : ""}`;
  button.type = "button";
  button.title = de ? "Erkannte verwaiste Entitäten anzeigen" : "Show detected orphaned entities";
  button.innerHTML = `
    <span class="tab-icon orphan"><ha-icon icon="mdi:link-off"></ha-icon></span>
    <span class="tab-copy">
      <strong>${de ? "Verwaiste Entitäten · BETA" : "Orphaned entities · BETA"}</strong>
      <small class="aem-orphan-count">${aemOrphanEscape(label)}</small>
    </span>`;
  if (!existing) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      aemOrphanOpenPage(instance);
    });
    const third = tabs.querySelector(".status-tab.not-exposed") || tabs.querySelectorAll(".status-tab")[2];
    if (third?.nextSibling) tabs.insertBefore(button, third.nextSibling);
    else tabs.appendChild(button);
  }
}

function aemOrphanRenderSettingsCard(instance, container) {
  if (!container?.isConnected) return;
  const de = aemOrphanIsGerman(instance?._hass);
  const data = instance.__aemOrphanData;
  const days = Number.isInteger(data?.candidate_after_days) ? data.candidate_after_days : 30;
  const message = instance.__aemOrphanSettingsMessage || "";
  const isError = Boolean(instance.__aemOrphanSettingsError);
  container.innerHTML = `
    <span class="aem-orphan-settings-icon"><ha-icon icon="mdi:link-off"></ha-icon></span>
    <span class="aem-orphan-settings-copy">
      <strong>${de ? "Verwaiste Entitäten · BETA" : "Orphaned entities · BETA"}</strong>
      <small>${de ? "BETA: Noch fehlen breitere Erfahrungen aus unterschiedlichen Home-Assistant-Installationen. Entität als Kandidat erkennen, wenn sie diese Anzahl Tage durchgehend nicht erreichbar oder nicht mehr bereitgestellt ist. Standard: 30 Tage." : "BETA: Broader real-world experience across different Home Assistant installations is still limited. Detect an entity as a candidate after it has been continuously unavailable or no longer provided for this many days. Default: 30 days."}</small>
      ${message ? `<span class="aem-orphan-settings-message ${isError ? "error" : ""}">${aemOrphanEscape(message)}</span>` : ""}
    </span>
    <span class="aem-orphan-settings-controls">
      <input class="aem-orphan-days-inline" type="number" min="0" step="1" value="${days}" aria-label="${de ? "Tage" : "Days"}">
      <span>${de ? "Tage" : "days"}</span>
      <button class="aem-orphan-save-inline" type="button">${de ? "Speichern" : "Save"}</button>
    </span>`;

  container.querySelector(".aem-orphan-save-inline")?.addEventListener("click", async () => {
    const input = container.querySelector(".aem-orphan-days-inline");
    const button = container.querySelector(".aem-orphan-save-inline");
    const next = Number.parseInt(input?.value || "", 10);
    if (!Number.isInteger(next) || next < 0) {
      instance.__aemOrphanSettingsError = true;
      instance.__aemOrphanSettingsMessage = de ? "Bitte eine ganze Zahl ab 0 eingeben." : "Enter a whole number of 0 or more.";
      aemOrphanRenderSettingsCard(instance, container);
      return;
    }
    if (button) button.disabled = true;
    try {
      const updated = await aemOrphanCallWS(instance?._hass, {
        type: "assist_entity_manager/orphans/settings/update",
        candidate_after_days: next,
      });
      instance.__aemOrphanSettingsError = false;
      instance.__aemOrphanSettingsMessage = de ? `${next} Tage gespeichert.` : `${next} days saved.`;
      aemOrphanApplyDataToInstance(instance, updated);
    } catch (err) {
      instance.__aemOrphanSettingsError = true;
      instance.__aemOrphanSettingsMessage = err?.message || String(err);
      aemOrphanRenderSettingsCard(instance, container);
    }
  });
}

function aemOrphanDecorateSettings(instance) {
  const root = instance?.shadowRoot;
  if (!root || instance?._utilityPanel !== "settings" || !instance?._hass?.user?.is_admin) return;
  const content = root.querySelector(".utility-panel .utility-content");
  if (!content) return;
  let row = content.querySelector(".aem-orphan-settings-row");
  if (!row) {
    row = document.createElement("div");
    row.className = "aem-orphan-settings-row";
    const explanation = content.querySelector(".settings-explanation");
    if (explanation) content.insertBefore(row, explanation);
    else content.appendChild(row);
  }
  aemOrphanRenderSettingsCard(instance, row);
}

function aemOrphanApplyDataToInstance(instance, data) {
  if (!instance || !data || typeof data !== "object") return;
  instance.__aemOrphanData = data;
  instance.__aemOrphanDataAt = Date.now();
  aemOrphanRenderStatusTile(instance);
  if (instance?._utilityPanel === "settings") aemOrphanDecorateSettings(instance);
  if (instance?.__aemOrphanPageOpen) {
    if (aemOrphanDetectedCount(data) > 0) aemOrphanRenderInlinePage(instance);
    else aemOrphanClosePage(instance);
  }
  aemOrphanDecorateEntityRows(instance);
  aemOrphanDecorateDetails(instance);
}

async function aemOrphanRefreshData(instance, force = false) {
  if (!instance?._hass?.user?.is_admin || instance.__aemOrphanDataLoading) return;
  const age = Date.now() - Number(instance.__aemOrphanDataAt || 0);
  if (!force && instance.__aemOrphanData && age < 60000) return;
  instance.__aemOrphanDataLoading = true;
  try {
    const data = await aemOrphanCallWS(instance._hass, {
      type: "assist_entity_manager/orphans/list",
    });
    aemOrphanApplyDataToInstance(instance, data);
  } catch (_err) {
    // The orphan feature must never break the normal AEM UI if its optional
    // background status request fails. The normal settings save path shows errors.
  } finally {
    instance.__aemOrphanDataLoading = false;
  }
}

function aemOrphanEnsurePolling(instance) {
  if (instance.__aemOrphanPollTimer) return;
  const tick = async () => {
    instance.__aemOrphanPollTimer = null;
    if (!instance.isConnected) return;
    await aemOrphanRefreshData(instance, true);
    if (instance.isConnected) {
      instance.__aemOrphanPollTimer = window.setTimeout(tick, 60000);
    }
  };
  instance.__aemOrphanPollTimer = window.setTimeout(tick, 60000);
}

function aemOrphanDecorate(instance) {
  const root = instance?.shadowRoot;
  if (!root || !instance?._hass?.user?.is_admin) return;
  aemOrphanInstallMainStyle(instance);
  aemOrphanRenderStatusTile(instance);
  aemOrphanBindTopNavigation(instance);
  aemOrphanDecorateSettings(instance);
  aemOrphanRenderInlinePage(instance);
  aemOrphanDecorateEntityRows(instance);
  aemOrphanDecorateDetails(instance);
  aemOrphanRefreshData(instance, false);
  aemOrphanEnsurePolling(instance);
}

function aemOrphanInstall(tag) {
  customElements.whenDefined(tag).then(() => {
    const proto = customElements.get(tag)?.prototype;
    if (!proto || proto.__aemOrphanUiInstalled) return;
    Object.defineProperty(proto, "__aemOrphanUiInstalled", { value: true });
    const originalRender = proto._render;
    if (typeof originalRender === "function") {
      proto._render = function (...args) {
        const result = originalRender.apply(this, args);
        queueMicrotask(() => aemOrphanDecorate(this));
        return result;
      };
    }
  });
}

aemOrphanInstall("assist-entity-manager-de");
aemOrphanInstall("assist-entity-manager-en");
console.info(`Assist Entity Manager orphan UI ${AEM_ORPHAN_UI_VERSION} loaded`);

})();
