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

-- Watchlist: Serien/Anime/Filme, die in ein Wochen-Fernsehprogramm münden (siehe
-- wissensdatenbank/features/watchlist-fernsehprogramm.md). Muss vor tasks stehen, weil
-- tasks.watchlist_item_id unten darauf verweist.
create table if not exists watchlist_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  type text not null default 'serie' check (type in ('serie', 'anime', 'film', 'doku', 'youtube')),
  genres text[] default '{}',
  -- 'geplant' als konservativer Default (analog wishlist_items.status='inactive'): ein frisch
  -- angelegter Eintrag nimmt erst an der wöchentlichen Rotation teil, wenn er explizit auf 'aktiv'
  -- gesetzt wird.
  status text not null default 'geplant'
    check (status in ('aktiv', 'geplant', 'irgendwann', 'beendet', 'wartet_auf_neue_staffel')),
  platform text,
  -- null = Typ-Standard greift (45/20/90 Min., siehe DEFAULT_DURATION_MIN in js/watchlist.js),
  -- gesetzt = manueller Override.
  duration_minutes integer,
  current_season integer,
  current_episode integer,
  next_season_release_date date,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists watchlist_items_user_status_idx on watchlist_items (user_id, status);

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
  -- 'weekly' (Default) = jede Woche an den gewählten habit_weekdays fällig; 'biweekly'/'monthly'
  -- gaten zusätzlich über habit_last_due_date, siehe isRecurrenceDue() in js/habits.js.
  habit_recurrence text default 'weekly' check (habit_recurrence in ('weekly', 'biweekly', 'monthly')),
  -- Letzter Tag, an dem dieses Habit tatsächlich fällig wurde (Anker für die Intervall-Berechnung
  -- oben) — null = noch nie fällig geworden. Wird nur von autoplanDueHabits() geschrieben.
  habit_last_due_date date,
  -- Brücke zum Watchlist/Fernsehprogramm-Feature: eine Zeile mit gesetztem watchlist_item_id IST
  -- der Termin im Fernsehprogramm (planned_date = geplanter Tag), siehe js/watchlist.js. effort
  -- bleibt bei solchen Zeilen immer NULL — der effort-Check (5/10/30/60) passt nicht zu den
  -- Watchlist-Dauern (45/20/90 Min.), die stattdessen auf watchlist_items.duration_minutes leben.
  watchlist_item_id uuid references watchlist_items(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists tasks_parent_task_id_idx on tasks (parent_task_id);
create index if not exists tasks_watchlist_item_id_idx on tasks (watchlist_item_id);

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
  category text check (category is null or category in ('essen', 'wohnen', 'transport', 'freizeit', 'gesundheit', 'sonstiges')),
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

-- Watchlist: Sichtungs-Log — eine Zeile pro gesehener Episode/Film, Bewertung pro Sichtung statt
-- pro Item (eine schlecht bewertete Folge soll weder Priorität noch Rotation der Serie
-- beeinflussen). rating nullable — eine Sichtung wird immer geloggt, die Bewertung selbst kann
-- übersprungen werden.
create table if not exists watchlist_viewing_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  watchlist_item_id uuid references watchlist_items(id) on delete cascade not null,
  rating integer check (rating between 1 and 10),
  season integer,
  episode integer,
  watched_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists watchlist_viewing_log_item_idx on watchlist_viewing_log (watchlist_item_id);

-- Habit-Streak-Log: eine Zeile pro Tag, an dem eine Habit-Mutter (direkt oder über ein Pool-Kind)
-- erledigt wurde. unique(task_id, date) macht das Logging in completeTaskCascade() idempotent.
create table if not exists habit_completions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  date date not null,
  created_at timestamptz default now(),
  unique (task_id, date)
);

create index if not exists habit_completions_task_id_idx on habit_completions (task_id);

-- Geburtstage: eigener, simpler Datensatz statt Sonderfall von tasks/areas, da ein Geburtstag
-- jedes Jahr wiederkehrt und selbst nie "geplant/erledigt" ist. year optional (nur Altersanzeige).
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

-- Tagesreflexion: eigene Tabelle statt Aufgaben-Missbrauch. unique(user_id, date) macht "wurde für
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
alter table watchlist_items enable row level security;
alter table watchlist_viewing_log enable row level security;
alter table habit_completions enable row level security;
alter table birthdays enable row level security;
alter table daily_reflections enable row level security;

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

drop policy if exists "watchlist_items: own data" on watchlist_items;
create policy "watchlist_items: own data" on watchlist_items for all using (auth.uid() = user_id);

drop policy if exists "watchlist_viewing_log: own data" on watchlist_viewing_log;
create policy "watchlist_viewing_log: own data" on watchlist_viewing_log for all using (auth.uid() = user_id);

drop policy if exists "habit_completions: own data" on habit_completions;
create policy "habit_completions: own data" on habit_completions for all using (auth.uid() = user_id);

drop policy if exists "birthdays: own data" on birthdays;
create policy "birthdays: own data" on birthdays for all using (auth.uid() = user_id);

drop policy if exists "daily_reflections: own data" on daily_reflections;
create policy "daily_reflections: own data" on daily_reflections for all using (auth.uid() = user_id);

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

drop trigger if exists watchlist_items_updated_at on watchlist_items;
create trigger watchlist_items_updated_at
  before update on watchlist_items
  for each row execute function update_updated_at();
