# PostgreSQL preparation

This directory contains only the future production schema. The running API still uses `backend/data/imoveis.json` and the existing filesystem.

## Mapping

- `properties.id` preserves the numeric JSON `id`.
- `properties.*` maps the existing property fields without changing their values.
- `properties.destaque === true` maps to one row in `featured_properties`.
- `properties.diretorioImagens` maps to `properties.diretorio_imagens_legado`.
- Each existing legacy file becomes a `property_images` row with `is_legacy = true` during the future migration.
- Each managed JSON `fotos` path becomes a `property_images` row with `is_legacy = false`.
- The environment-provided administrator maps to `admins`; its bcrypt hash is never generated or copied by the export script.

`featured_properties.position` is the public slot from 1 through 6. The database trigger prevents a seventh row. The future application migration must perform swaps and removals inside transactions and must require a valid six-row configuration before switching the public PostgreSQL reader on.

Do not run `schema.sql` against production yet. Review the generated export and take a PostgreSQL backup before the eventual migration.
