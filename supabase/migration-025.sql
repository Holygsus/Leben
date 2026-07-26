-- Leben OS — Migration 025
-- Update 2026-07-26: via Supabase-MCP angewendet, live in der Produktions-DB verifiziert —
-- nicht erneut ausführen.
--
-- Frei editierbare Ausgaben-Kategorien (wissensdatenbank/finanzen-erweiterungen/
-- finanzplan-erweiterungen-v2.md, Punkt 9, War-Room-Update 2026-07-25). Löst den festen
-- 6-Werte-CHECK auf transactions.category (migration-013) durch eine nutzer-eigene Tabelle ab.
-- transactions.category speichert weiterhin einen text-KEY (jetzt frei statt Enum) — die bestehenden
-- Slugs (essen/wohnen/transport/freizeit/gesundheit/sonstiges) bleiben gültige Keys, daher KEINE
-- Datenmigration bestehender Transaktionen. Der 9er-Default-Satz wird lazy im Client geseedet.

create table if not exists expense_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  key text not null,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  unique (user_id, key)
);

alter table expense_categories enable row level security;
drop policy if exists "expense_categories: own data" on expense_categories;
create policy "expense_categories: own data" on expense_categories for all using (auth.uid() = user_id);

-- Festes Kategorie-Enum ablösen — category bleibt nullable text, jetzt aber frei.
alter table transactions drop constraint if exists transactions_category_check;
