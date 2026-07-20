-- Leben OS — Migration 017
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Watchlist-Viewing-Log: "kind" unterscheidet tatsächlich geschaute Sichtungen von manuell als
-- "nicht geschaut" markierten Abschlüssen (siehe wissensdatenbank/implementieren-jetzt.md,
-- Triage 2026-07-20) — bisher loggte jedes Abhaken einer Watchlist-Aufgabe fälschlich immer eine
-- Sichtung, auch wenn der Nutzer gar nicht geschaut hat.

alter table watchlist_viewing_log
  add column if not exists kind text not null default 'watched' check (kind in ('watched', 'skipped'));
