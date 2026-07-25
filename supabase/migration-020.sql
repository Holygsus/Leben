-- Leben OS — Migration 020
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Schulden-Erfassung für den Sparplan (siehe
-- wissensdatenbank/finanzen-erweiterungen/finanzplan-erweiterungen-v2.md, Punkt 6). Schulden sind
-- ein Bestand mit Resttilgung + optional Zins — bewusst eine eigene Tabelle statt Wiederverwendung
-- von committed_expenses (das ist ein Termin-Ereignis mit fixem Fälligkeitsdatum, keine laufende
-- Restschuld). Die Vorrang-Logik (Tilgung vor Wachstums-/Freiheit-Zuteilung) läuft im Weekly Review,
-- nicht in dieser Tabelle.

create table if not exists debts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  initial_amount numeric(10,2) not null,
  remaining_amount numeric(10,2) not null,
  interest_rate numeric(5,2),      -- nullable, in % p.a.
  min_payment numeric(10,2),       -- nullable, monatliche Mindestrate
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table debts enable row level security;
drop policy if exists "debts: own data" on debts;
create policy "debts: own data" on debts for all using (auth.uid() = user_id);
