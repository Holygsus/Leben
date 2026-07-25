-- Leben OS — Migration 023
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
-- Update 2026-07-25: via Supabase-MCP angewendet, live in der Produktions-DB verifiziert —
-- nicht erneut ausführen.
--
-- "Lesen als Bereich" — einfache Seiten-Variante (siehe wissensdatenbank/features/lesen-als-bereich.md).
-- books = Bestand mit Seiten-Fortschritt, book_reading_log = einzelne Lese-Sessions für die
-- Monats-Übersicht (Summenabfrage, ohne current_page destruktiv zu überschreiben). Kapitelstruktur
-- und immersive Optik bewusst später.

create table if not exists books (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  author text,
  total_pages integer,
  current_page integer not null default 0,
  status text not null default 'geplant'
    check (status in ('geplant', 'aktiv', 'pausiert', 'beendet')),
  genre text,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists book_reading_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  book_id uuid references books(id) on delete cascade,
  date date not null default current_date,
  pages_read integer not null,
  created_at timestamptz default now()
);

alter table books enable row level security;
drop policy if exists "books: own data" on books;
create policy "books: own data" on books for all using (auth.uid() = user_id);

alter table book_reading_log enable row level security;
drop policy if exists "book_reading_log: own data" on book_reading_log;
create policy "book_reading_log: own data" on book_reading_log for all using (auth.uid() = user_id);
