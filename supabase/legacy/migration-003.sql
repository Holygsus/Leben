-- Leben OS — Migration 003
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
-- NUR ausführen, nachdem migration-002.sql gelaufen ist UND die Datenmigration
-- (runProjectMigration() in der Browser-Konsole) erfolgreich durchgeführt und in der App
-- visuell geprüft wurde. Danach entfernt dieser Schritt die alte Ordner/Projekt-Struktur
-- endgültig — vorher nochmal Backup pruefen!

alter table tasks drop column if exists project_id;
alter table tasks drop column if exists migrated_from_project_id;
drop table if exists projects;
