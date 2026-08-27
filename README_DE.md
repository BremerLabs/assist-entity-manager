# Assist Entity Manager

[English README](README.md)

Der Assist Entity Manager ist eine Home-Assistant-Custom-Integration zur Verwaltung von Sprachassistenten-Freigaben, Aliasen, Zuordnungen und Sprach-Namensprüfungen. Er bietet automatisch ein Vollbild-Panel in der Home-Assistant-Seitenleiste und lässt zusätzlich die optionale Lovelace-Custom-Card verfügbar.

## Sprache

Die Oberfläche richtet sich nach der **Home-Assistant-Benutzersprache**:

- `de` / `de-*` → Deutsch
- jede andere Home-Assistant-Sprache → englischer Fallback

Auch der Einrichtungsdialog verwendet Home-Assistant-Übersetzungen. Englisch und Deutsch sind enthalten.

## Funktionen

- Freigaben für Home Assistant Assist, Amazon Alexa und Google Assistant verwalten, sofern die Assistenten in HA aktiviert sind
- Aliase und den HA-Schalter „Standardname als ersten Alias verwenden“ bearbeiten
- den Home-Assistant-Bereich einer Entität und als Administrator auch die Gerätezuordnung mit konservativen Sicherheitsprüfungen bearbeiten
- Entitäten den Bereich ihres zugeordneten Geräts automatisch übernehmen lassen, ohne einen dauerhaften Bereichs-Override zu setzen
- Entitäten nach Gerät gruppieren und verständliche Geräteklassen anzeigen
- echte gesprochene Namenskonflikte erkennen und beabsichtigte Konflikte pro Entität ignorieren
- möglicherweise uneindeutige Namen und vermutlich unnötige Sprach-Entitäten erkennen
- Integrationen aus der aktuellen Ansicht ausschließen
- Freigabeänderungen erkennen, die außerhalb des Assist Entity Managers erfolgt sind
- JSON-Backup/Export und abgesicherten Import mit Schema-Migration verwenden
- automatisches Sidebar-Panel plus optionale manuelle Lovelace-Karte
- deutsche Oberfläche und englischen Fallback für alle anderen HA-Sprachen verwenden

### Beta-Funktionen

Die folgenden Funktionen aus v1.2.0 sind bewusst als **BETA** gekennzeichnet, solange noch breitere Erfahrungen aus unterschiedlichen realen Home-Assistant-Installationen gesammelt werden:

- **Manuelle/YAML-Alexa-Smart-Home-Erkennung (BETA):** erkennt selbst gehostete bzw. manuelle Alexa-Smart-Home-Konfigurationen über die von Home Assistant geladene Konfiguration und die Alexa-Freigabelogik. Manuelle YAML-Freigaben bleiben in AEM absichtlich nur lesbar; AEM schreibt weder `configuration.yaml` noch Include-Dateien um.
- **Verwaiste Entitäten (BETA):** beobachtet nicht verfügbare bzw. nicht mehr bereitgestellte Entitäten, zeigt Administratoren Verwendungen und Sicherheitsinformationen an, erlaubt das Schützen von Kandidaten und eine ausdrücklich bestätigte Bereinigung verwaister Registry-Einträge. AEM löscht niemals automatisch eine Entität nur aufgrund ihres Alters oder weil sie nicht verfügbar ist.

Rückmeldungen und reproduzierbare Fehlerberichte zu beiden Beta-Funktionen sind besonders willkommen.

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
