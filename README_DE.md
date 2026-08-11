# Assist Entity Manager

[English README](README.md)

Der Assist Entity Manager ist eine Home-Assistant-Custom-Integration zur Verwaltung von Sprachassistenten-Freigaben, Aliasen und Sprach-Namensprüfungen. Er bietet automatisch ein Vollbild-Panel in der Home-Assistant-Seitenleiste und lässt zusätzlich die optionale Lovelace-Custom-Card verfügbar.

## Sprache

Die Oberfläche richtet sich nach der **Home-Assistant-Benutzersprache**:

- `de` / `de-*` → Deutsch
- jede andere Home-Assistant-Sprache → englischer Fallback

Auch der Einrichtungsdialog verwendet Home-Assistant-Übersetzungen. Englisch und Deutsch sind enthalten.

## Funktionen

- Freigaben für Home Assistant Assist, Amazon Alexa und Google Assistant verwalten, sofern die Assistenten in HA aktiviert sind
- Aliase und den HA-Schalter „Standardname als ersten Alias verwenden“ bearbeiten
- Entitäten nach Gerät gruppieren und verständliche Geräteklassen anzeigen
- echte gesprochene Namenskonflikte erkennen und beabsichtigte Konflikte pro Entität ignorieren
- möglicherweise uneindeutige Namen und vermutlich unnötige Sprach-Entitäten erkennen
- Integrationen aus der aktuellen Ansicht ausschließen
- Freigabeänderungen erkennen, die außerhalb des Assist Entity Managers erfolgt sind
- JSON-Backup/Export und abgesicherten Import mit Schema-Migration verwenden
- automatisches Sidebar-Panel plus optionale manuelle Lovelace-Karte
- deutsche Oberfläche und englischer Fallback für alle anderen HA-Sprachen

## Installation mit HACS

Bis das Repository in den HACS-Standardkatalog aufgenommen wurde, wird es als **benutzerdefiniertes Repository** der Kategorie **Integration** hinzugefügt. Danach:

1. **Assist Entity Manager** in HACS installieren.
2. Home Assistant neu starten.
3. **Einstellungen → Geräte & Dienste → Integration hinzufügen** öffnen.
4. **Assist Entity Manager** hinzufügen.
5. Das Panel **Assist Manager** wird automatisch in der Seitenleiste angelegt.

## Optionale manuelle Dashboard-Karte

Die Integration registriert dieselbe Lovelace-Karte zusätzlich global. Sie kann deshalb ohne zweites HACS-Paket in beliebigen Dashboards verwendet werden:

```yaml
type: custom:assist-entity-manager
```

## Backup-Kompatibilität

Exporte enthalten eine Schema-Version. Ältere unterstützte Schemas werden vor dem Import schrittweise migriert. Ein Backup mit einer unbekannten neueren Schema-Version wird **vor** Änderungen an Home Assistant abgelehnt.

## Support

Für reproduzierbare Fehler und Feature-Wünsche bitte GitHub Issues verwenden. Bei Fehlern möglichst Home-Assistant-Version, Assist-Entity-Manager-Version, aktive Sprachassistenten und Browser/App angeben.

## Lizenz

MIT-Lizenz. Siehe [LICENSE](LICENSE).
