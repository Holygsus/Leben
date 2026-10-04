-- Leben OS — Migration 012
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Tagesreflexion-Popup (siehe wissensdatenbank/features/tagesreflexion.md): eigene Tabelle statt
-- Aufgaben-Missbrauch, da eine Reflexion kein Task ist. unique(user_id, date) macht "wurde für
-- heute schon beantwortet?" zu einer einfachen Existenzprüfung und verhindert Duplikate.

create table if not exists daily_reflections (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  date date not null,
  mood int not null check (mood between 1 and 5),
  note text,
  created_at timestamptz default now(),
  unique (user_id, date)
);

create index if not exists daily_reflections_user_date_idx on daily_reflections (user_id, date);

alter table daily_reflections enable row level security;
drop policy if exists "daily_reflections: own data" on daily_reflections;
create policy "daily_reflections: own data" on daily_reflections for all using (auth.uid() = user_id);
