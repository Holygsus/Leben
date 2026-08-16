-- Leben OS — Migration 035
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Reiseplanung V1 (siehe wissensdatenbank/features/reiseplanung.md, War Room 2026-08-13). Eine Reise
-- hat eine zweite, zeitliche Dimension (Tage) plus einen Pool an Attraktionen — strukturell näher an
-- der Watchlist-Wochenplanung als an einer Todo-Liste, darum ein eigenes Modell (kein Wiederverwenden
-- von tasks). day_number statt konkretem Datum: Tage werden bei echter Planung ständig umgestellt,
-- eine Nummer ist stabiler. trip_items ohne day_number liegen im Pool (status 'kandidat').

create table if not exists trips (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  destination text,
  date_from date,
  date_to date,
  status text not null default 'geplant'
    check (status in ('geplant','aktiv','abgeschlossen')),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists trip_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  trip_id uuid references trips on delete cascade not null,
  title text not null,
  status text not null default 'kandidat'
    check (status in ('kandidat','eingeplant','erledigt')),
  day_number integer,
  time_slot text check (time_slot is null or time_slot in ('vormittag','nachmittag','abend')),
  category text,
  notes text,
  link text,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists trip_items_trip_id_idx on trip_items (trip_id);

alter table trips enable row level security;
drop policy if exists "trips: own data" on trips;
create policy "trips: own data" on trips for all using (auth.uid() = user_id);

alter table trip_items enable row level security;
drop policy if exists "trip_items: own data" on trip_items;
create policy "trip_items: own data" on trip_items for all using (auth.uid() = user_id);
