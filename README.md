# Assist Entity Manager

[Deutsche README](README_DE.md)

Assist Entity Manager is a Home Assistant custom integration for managing which entities are exposed to voice assistants, along with aliases and voice-name quality checks. It provides an automatic full-screen sidebar panel and keeps the optional Lovelace custom card available.

## Language

The frontend follows the **Home Assistant user language**:

- `de` / `de-*` → German
- every other Home Assistant language → English fallback

The config flow uses Home Assistant translations as well. English and German are included.

## Features

- Manage entity exposure for Home Assistant Assist, Amazon Alexa, and Google Assistant when those assistants are enabled in Home Assistant
- Edit aliases and Home Assistant's default-name-as-first-alias setting
- Group entities by device and display human-friendly device classes
- Detect real spoken-name conflicts and ignore intentional conflicts per entity
- Detect potentially ambiguous names and probably unnecessary voice entities
- Exclude integrations from the current view
- Detect exposure changes that happened outside Assist Entity Manager
- JSON backup/export and guarded import with schema migration support
- Automatic sidebar panel plus optional manual Lovelace card
- German UI with English fallback for all other Home Assistant languages

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
