-- Leben OS — Migration 021
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
-- Update 2026-07-25: via Supabase-MCP angewendet, live in der Produktions-DB (Tabelle + RLS-Policy
-- verifiziert) — nicht erneut ausführen.
--
-- Gaming-Backlog (siehe wissensdatenbank/features/gaming-backlog.md). Bewusst eine eigene Tabelle
-- statt Erweiterung von watchlist_items — Games unterscheiden sich strukturell (kontinuierlicher
-- Fortschritt statt Staffel/Folge, kein Wochenprogramm-Zwang). Diese Runde deckt nur den manuellen
-- Bestand; Kaufentscheidung/Preis läuft weiter über wishlist_items.

create table if not exists game_backlog_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  status text not null default 'backlog'
    check (status in ('wishlist','backlog','playing','paused','done','abandoned')),
  platform text,
  release_date date,
  progress_pct integer check (progress_pct is null or (progress_pct between 0 and 100)),
  priority text check (priority is null or priority in ('low','medium','high')),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table game_backlog_items enable row level security;
drop policy if exists "game_backlog_items: own data" on game_backlog_items;
create policy "game_backlog_items: own data" on game_backlog_items for all using (auth.uid() = user_id);
