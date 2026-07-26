-- Leben OS — Migration 024
-- Update 2026-07-26: via Supabase-MCP angewendet, live in der Produktions-DB verifiziert —
-- nicht erneut ausführen.
--
-- "Lesen als Bereich" — Kapitel-Zählung (Variante B), siehe
-- wissensdatenbank/features/lesen-als-bereich.md. Additive Erweiterung von Migration 023:
-- books hält jetzt BEIDE Fortschrittseinheiten (Seiten + Kapitel), progress_unit bestimmt die
-- pro-Buch-Default-Anzeige (für Sven 'chapters'). book_reading_log trägt pro Eintrag entweder
-- Seiten ODER Kapitel — daher wird pages_read nullable und chapters_read kommt dazu.

alter table books
  add column if not exists progress_unit text not null default 'chapters'
    check (progress_unit in ('pages', 'chapters')),
  add column if not exists total_chapters integer,
  add column if not exists current_chapter integer not null default 0;

alter table book_reading_log
  add column if not exists chapters_read integer;

alter table book_reading_log
  alter column pages_read drop not null;
