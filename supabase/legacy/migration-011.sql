-- Leben OS — Migration 011
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Geburtstage im Kalender (siehe wissensdatenbank/features/geburtstage-kalender.md): eigener,
-- simpler Datensatz statt Sonderfall von tasks/areas, da ein Geburtstag jedes Jahr wiederkehrt und
-- selbst nie "geplant/erledigt" ist. year ist optional (nur für Altersanzeige), day/month bestimmen
-- die jährliche Wiederkehr.

create table if not exists birthdays (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  day int not null check (day between 1 and 31),
  month int not null check (month between 1 and 12),
  year int,
  is_important boolean default false,
  created_at timestamptz default now()
);

create index if not exists birthdays_user_id_idx on birthdays (user_id);

alter table birthdays enable row level security;
drop policy if exists "birthdays: own data" on birthdays;
create policy "birthdays: own data" on birthdays for all using (auth.uid() = user_id);
