# Assist Entity Manager

[Deutsche README](README_DE.md)

Assist Entity Manager is a Home Assistant custom integration for managing which entities are exposed to voice assistants, along with aliases, assignments and voice-name quality checks. It provides an automatic full-screen sidebar panel and keeps the optional Lovelace custom card available.

## Language

The frontend follows the **Home Assistant user language**:

- `de` / `de-*` → German
- every other Home Assistant language → English fallback

The config flow uses Home Assistant translations as well. English and German are included.

## Features

- Manage entity exposure for Home Assistant Assist, Amazon Alexa, and Google Assistant when those assistants are enabled in Home Assistant
- Edit aliases and Home Assistant's default-name-as-first-alias setting
- Edit an entity's Home Assistant area assignment and, for administrators, its device assignment with conservative ownership checks
- Let an entity inherit its area from its assigned device instead of creating a permanent area override
- Group entities by device and display human-friendly device classes
- Detect real spoken-name conflicts and ignore intentional conflicts per entity
- Detect potentially ambiguous names and probably unnecessary voice entities
- Exclude integrations from the current view
- Detect exposure changes that happened outside Assist Entity Manager
- JSON backup/export and guarded import with schema migration support
- Automatic sidebar panel plus optional manual Lovelace card
- German UI with English fallback for all other Home Assistant languages

### Beta features

The following v1.2.0 features are intentionally marked **BETA** while broader real-world feedback from different Home Assistant installations is collected:

- **Manual/YAML Alexa Smart Home detection (BETA):** detects self-hosted/manual Alexa Smart Home configuration using Home Assistant's loaded configuration and Alexa exposure logic. Manual YAML exposure remains read-only in AEM; AEM does not rewrite `configuration.yaml` or include files.
- **Orphaned entities (BETA):** observes unavailable/no-longer-provided entities, lets administrators review references and safety information, protect candidates, and explicitly clean up confirmed orphaned registry entries. AEM never deletes an entity automatically just because it is old or unavailable.

Feedback and reproducible issue reports for both beta features are especially welcome.

## Installation with HACS

Until the repository is included in HACS defaults, add it as a **custom repository** with category **Integration**. Then:

1. Install **Assist Entity Manager** in HACS.
2. Restart Home Assistant.
3. Go to **Settings → Devices & services → Add integration**.
4. Add **Assist Entity Manager**.
5. The **Assist Manager** panel is added to the Home Assistant sidebar automatically.

## Optional manual dashboard card

The same integration also registers the Lovelace custom card globally, so it can be placed in any dashboard without installing a second HACS package:

```yaml
type: custom:assist-entity-manager
```

## Backup compatibility

Exports contain a schema version. Older supported schemas are migrated step by step before import. A backup from a newer, unknown schema is rejected **before** any Home Assistant changes are applied.

The project is designed so future releases can add migrations instead of silently breaking older backups.

## Support

Please use GitHub Issues for reproducible bugs or feature requests. When reporting a problem, include your Home Assistant version, Assist Entity Manager version, active voice assistants, and browser/app where relevant.

## License

MIT License. See [LICENSE](LICENSE).
