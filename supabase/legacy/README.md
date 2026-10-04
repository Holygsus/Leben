# Legacy-Migrationen

Historische, von Hand nummerierte Migrationen (`migration-001.sql` … `migration-036.sql`).

- 001–008 stammen aus der Zeit vor dem Migrations-Tracking der Datenbank.
- Ab 009 liegt die maßgebliche Fassung in `../migrations/` (Supabase-CLI-Layout,
  `<version>_<name>.sql`, identisch mit `supabase_migrations.schema_migrations`).
- Diese Dateien nie erneut ausführen. Sie dienen nur als Dokumentation.
