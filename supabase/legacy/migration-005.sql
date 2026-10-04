-- Leben OS — Migration 005
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Legt das Datenmodell für Finanzplan + Sparplan/Wunschliste an (siehe
-- wissensdatenbank/finanzplan-architektur.md und wissensdatenbank/sparplan-architektur.md).
-- Komplett additiv, kein Bezug zu bestehenden Tabellen außer der geteilten
-- update_updated_at()-Funktion (bereits in schema.sql angelegt).

-- Einnahmen & Ausgaben
create table if not exists transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  direction text not null check (direction in ('income', 'expense')),
  amount numeric(10,2) not null,
  pot text check (pot in ('fixkosten', 'sicherheit', 'wachstum', 'freiheit')),
  category text,
  note text,
  source text not null default 'manual' check (source in ('manual', 'scan')),
  occurred_at date not null default current_date,
  created_at timestamptz default now()
);

-- Einzelpositionen aus Kassenbon-Scans (OCR-Rohtext + ggf. gemappte Kategorie)
create table if not exists receipt_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  transaction_id uuid references transactions(id) on delete cascade,
  raw_text text not null,
  product_name text,
  category text,
  amount numeric(10,2),
  created_at timestamptz default now()
);

-- Gelernte Produkt→Kategorie-Zuordnung (wird bei künftigen Scans automatisch angewendet)
create table if not exists category_mappings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  product_key text not null,
  category text not null,
  created_at timestamptz default now(),
  unique (user_id, product_key)
);

-- Wiederkehrende Fixkosten
create table if not exists fixed_costs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  amount numeric(10,2) not null,
  interval text not null check (interval in ('monthly', 'quarterly', 'yearly')),
  category text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Verpflichtende Ausgaben — geteilt zwischen Finanzplan und Sparplan (eine Tabelle, kein Duplikat)
create table if not exists committed_expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  amount numeric(10,2) not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'settled')),
  created_at timestamptz default now()
);

-- Investment-Tracking (Phase 3, manuelle Pflege)
create table if not exists portfolio_positions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  current_value numeric(10,2) not null default 0,
  monthly_contribution numeric(10,2),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Wunschliste — Rohtext-Einstieg, Anreicherung (Preis/Link/Kategorie/Prio) im Weekly Review
create table if not exists wishlist_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  category text check (category in ('need', 'invest', 'enjoy')),
  status text not null default 'inactive'
    check (status in ('inactive', 'active', 'ready', 'bought')),
  current_price numeric(10,2),
  product_url text,
  priority integer check (priority in (1, 2, 3)),
  last_price_check_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Spartopf-Ledger statt Einzelwert — jede Weekly-Zuteilung ist eine eigene Zeile, Stand = sum(amount)
create table if not exists savings_pot_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  amount numeric(10,2) not null,
  note text,
  entry_date date not null default current_date,
  created_at timestamptz default now()
);

-- Row Level Security
alter table transactions enable row level security;
alter table receipt_items enable row level security;
alter table category_mappings enable row level security;
alter table fixed_costs enable row level security;
alter table committed_expenses enable row level security;
alter table portfolio_positions enable row level security;
alter table wishlist_items enable row level security;
alter table savings_pot_entries enable row level security;

drop policy if exists "transactions: own data" on transactions;
create policy "transactions: own data" on transactions for all using (auth.uid() = user_id);

drop policy if exists "receipt_items: own data" on receipt_items;
create policy "receipt_items: own data" on receipt_items for all using (auth.uid() = user_id);

drop policy if exists "category_mappings: own data" on category_mappings;
create policy "category_mappings: own data" on category_mappings for all using (auth.uid() = user_id);

drop policy if exists "fixed_costs: own data" on fixed_costs;
create policy "fixed_costs: own data" on fixed_costs for all using (auth.uid() = user_id);

drop policy if exists "committed_expenses: own data" on committed_expenses;
create policy "committed_expenses: own data" on committed_expenses for all using (auth.uid() = user_id);

drop policy if exists "portfolio_positions: own data" on portfolio_positions;
create policy "portfolio_positions: own data" on portfolio_positions for all using (auth.uid() = user_id);

drop policy if exists "wishlist_items: own data" on wishlist_items;
create policy "wishlist_items: own data" on wishlist_items for all using (auth.uid() = user_id);

drop policy if exists "savings_pot_entries: own data" on savings_pot_entries;
create policy "savings_pot_entries: own data" on savings_pot_entries for all using (auth.uid() = user_id);

-- Auto-Timestamp (wiederverwendet die bestehende update_updated_at()-Funktion aus schema.sql)
drop trigger if exists fixed_costs_updated_at on fixed_costs;
create trigger fixed_costs_updated_at
  before update on fixed_costs
  for each row execute function update_updated_at();

drop trigger if exists wishlist_items_updated_at on wishlist_items;
create trigger wishlist_items_updated_at
  before update on wishlist_items
  for each row execute function update_updated_at();
