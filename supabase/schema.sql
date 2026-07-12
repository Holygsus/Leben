-- Leben OS — Datenbankschema
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Entspricht dem aktuellen Live-Stand: die frühere "projects"-Tabelle wurde durch
-- selbstreferenzierende Aufgaben (tasks.parent_task_id) ersetzt und per migration-002.sql /
-- migration-003.sql entfernt (siehe supabase/ für die historischen Migrationsschritte). Wer die
-- Datenbank frisch aufsetzt, braucht nur dieses eine Skript.

-- Lebensbereiche
create table if not exists areas (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  color text not null default '#888888',
  icon text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  unique (user_id, name)
);

-- Aufgaben (frei verschachtelbar über parent_task_id; is_pinned markiert schnell auffindbare
-- Aufgaben in der Übersicht)
create table if not exists tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  area_id uuid references areas on delete set null,
  parent_task_id uuid references tasks(id) on delete cascade,
  title text not null,
  effort integer check (effort in (5, 10, 30, 60)),
  status text default 'open' check (status in ('open', 'planned', 'done')),
  planned_date date,
  is_brainstorm boolean default false,
  is_pinned boolean default false,
  priority text check (priority in ('low', 'medium', 'high')) default 'medium',
  is_event boolean default false,
  -- null = kein Habit; [] = Habit-Flag gesetzt, noch keine Wochentage gewählt; nicht-leeres
  -- Array = aktive Wochentags-Zuordnung ('mon'..'sun'), siehe js/habits.js
  habit_weekdays text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists tasks_parent_task_id_idx on tasks (parent_task_id);

-- Tagespläne
create table if not exists daily_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  plan_date date not null,
  task_ids uuid[] default '{}',
  created_at timestamptz default now(),
  unique(user_id, plan_date)
);

-- Module (für spätere Zahnräder — u.a. Finanzplan-Konfiguration, name = 'finanzplan').
-- unique(user_id, name) macht das Get-or-create in getFinanceModuleSettings() race-safe: ohne
-- diesen Constraint könnten zwei parallele erste Ladevorgänge je eine 'finanzplan'-Zeile anlegen,
-- woraufhin jede weitere Abfrage mit .maybeSingle() an der Mehrdeutigkeit scheitert.
create table if not exists modules (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  is_active boolean default false,
  settings jsonb default '{}',
  created_at timestamptz default now(),
  unique (user_id, name)
);

-- Finanzplan: Einnahmen & Ausgaben
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

-- Finanzplan: Einzelpositionen aus Kassenbon-Scans
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

-- Finanzplan: gelernte Produkt→Kategorie-Zuordnung
create table if not exists category_mappings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  product_key text not null,
  category text not null,
  created_at timestamptz default now(),
  unique (user_id, product_key)
);

-- Finanzplan: wiederkehrende Fixkosten
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

-- Verpflichtende Ausgaben — geteilt zwischen Finanzplan und Sparplan
create table if not exists committed_expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  amount numeric(10,2) not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'settled')),
  created_at timestamptz default now()
);

-- Finanzplan: Investment-Tracking (Phase 3, manuelle Pflege)
create table if not exists portfolio_positions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  current_value numeric(10,2) not null default 0,
  monthly_contribution numeric(10,2),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Sparplan: Wunschliste — Rohtext-Einstieg, Anreicherung im Weekly Review
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

-- Sparplan: Spartopf-Ledger statt Einzelwert — Stand = sum(amount)
create table if not exists savings_pot_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  amount numeric(10,2) not null,
  note text,
  entry_date date not null default current_date,
  created_at timestamptz default now()
);

-- Row Level Security
alter table areas enable row level security;
alter table tasks enable row level security;
alter table daily_plans enable row level security;
alter table modules enable row level security;
alter table transactions enable row level security;
alter table receipt_items enable row level security;
alter table category_mappings enable row level security;
alter table fixed_costs enable row level security;
alter table committed_expenses enable row level security;
alter table portfolio_positions enable row level security;
alter table wishlist_items enable row level security;
alter table savings_pot_entries enable row level security;

drop policy if exists "areas: own data" on areas;
create policy "areas: own data" on areas for all using (auth.uid() = user_id);

drop policy if exists "tasks: own data" on tasks;
create policy "tasks: own data" on tasks for all using (auth.uid() = user_id);

drop policy if exists "daily_plans: own data" on daily_plans;
create policy "daily_plans: own data" on daily_plans for all using (auth.uid() = user_id);

drop policy if exists "modules: own data" on modules;
create policy "modules: own data" on modules for all using (auth.uid() = user_id);

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

-- Auto-Timestamp für tasks.updated_at (und weitere Tabellen mit updated_at)
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at
  before update on tasks
  for each row execute function update_updated_at();

drop trigger if exists fixed_costs_updated_at on fixed_costs;
create trigger fixed_costs_updated_at
  before update on fixed_costs
  for each row execute function update_updated_at();

drop trigger if exists wishlist_items_updated_at on wishlist_items;
create trigger wishlist_items_updated_at
  before update on wishlist_items
  for each row execute function update_updated_at();
