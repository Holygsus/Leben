-- Leben OS — Migration 004
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Fügt Prioritäten und einen "ist Termin"-Flag zu tasks hinzu. Beides additiv mit
-- Defaults, kein Backfill nötig — bestehende Zeilen bekommen priority='medium' bzw.
-- is_event=false automatisch.

alter table tasks add column if not exists priority text check (priority in ('low', 'medium', 'high')) default 'medium';
alter table tasks add column if not exists is_event boolean default false;
