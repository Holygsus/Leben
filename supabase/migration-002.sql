-- Leben OS — Migration 002
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
-- Fundament für Unteraufgaben: Projekte/Ordner werden durch selbstreferenzierende
-- Aufgaben (parent_task_id) ersetzt. Diese Migration legt nur die neuen Spalten an —
-- die Tabelle "projects" bleibt vorerst bestehen, bis die Daten migriert und geprüft
-- wurden (siehe migrate-projects.js) und migration-003.sql sie final entfernt.

alter table tasks
  add column if not exists parent_task_id uuid references tasks(id) on delete cascade;

alter table tasks
  add column if not exists is_pinned boolean default false;

-- Nur für die einmalige Datenmigration: hält fest, aus welcher alten projects-Zeile
-- eine migrierte Aufgabe entstanden ist. Wird von migration-003.sql wieder entfernt.
alter table tasks
  add column if not exists migrated_from_project_id uuid;

create index if not exists tasks_parent_task_id_idx on tasks (parent_task_id);
