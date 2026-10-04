-- Leben OS — Migration 015
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Rezepte speichern (siehe wissensdatenbank/features/kochen-rezepte-kuehlschrank.md, Punkt 1) —
-- Grundlage für den später geplanten digitalen Kühlschrank/Kochen-fördern. Zutaten als jsonb-Array
-- [{ name, amount }] auf der Recipe-Zeile selbst, kein eigenes Join (Zutaten werden nie unabhängig
-- vom Rezept abgefragt). name ist Pflicht (Basis fürs künftige Kühlschrank-Matching), amount ein
-- freies, unvalidiertes Textfeld ("200g Mehl", "1 Prise Salz").

create table if not exists recipes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  ingredients jsonb not null default '[]',
  instructions text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists recipes_user_id_idx on recipes (user_id);

alter table recipes enable row level security;
drop policy if exists "recipes: own data" on recipes;
create policy "recipes: own data" on recipes for all using (auth.uid() = user_id);

drop trigger if exists recipes_updated_at on recipes;
create trigger recipes_updated_at
  before update on recipes
  for each row execute function update_updated_at();
