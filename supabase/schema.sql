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
  last_served_at timestamptz,
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
  season_count integer,
  episode_counts_by_season jsonb,
  next_season_release_date date,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists watchlist_items_user_status_idx on watchlist_items (user_id, status);

-- Rezepte speichern (siehe wissensdatenbank/features/kochen-rezepte-kuehlschrank.md, Punkt 1) —
-- Grundlage für den später geplanten digitalen Kühlschrank/Kochen-fördern. Zutaten als jsonb-Array
-- [{ name, amount }] auf der Recipe-Zeile selbst, kein eigenes Join. name ist Pflicht (Basis fürs
-- künftige Kühlschrank-Matching), amount ein freies, unvalidiertes Textfeld.
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
  -- Gesetzt = Zähl-Habit (mengen-basiert, migration-026): speichert das Einheiten-Label
  -- (z. B. "Glas"/"Zigarette"). Erfassung über habit_counter_log, nicht über planned/done — ein
  -- Zähl-Habit läuft nie über den Tagesplan (siehe findHabitsDueToday in js/habits.js).
  habit_unit text,
  -- Brücke zum Watchlist/Fernsehprogramm-Feature: eine Zeile mit gesetztem watchlist_item_id IST
  -- der Termin im Fernsehprogramm (planned_date = geplanter Tag), siehe js/watchlist.js. effort
  -- bleibt bei solchen Zeilen immer NULL — der effort-Check (5/10/30/60) passt nicht zu den
  -- Watchlist-Dauern (45/20/90 Min.), die stattdessen auf watchlist_items.duration_minutes leben.
  watchlist_item_id uuid references watchlist_items(id) on delete cascade,
  -- Folgeaufgaben-Skill (migration-027, wissensdatenbank/features/folgeaufgaben-vorschlaege.md):
  -- Steuer-Flag ('pending' wartet auf Analyse / 'suggested' hat offene Vorschläge / 'closed' nie
  -- wieder), NULL = normal. Wird beim Abhaken der abgehakten Wurzel gesetzt (js/tasks.js).
  followup_status text check (followup_status in ('pending', 'suggested', 'closed')),
  -- Lineage der Folgeaufgaben-Kette, bewusst getrennt von parent_task_id (eine Folgeaufgabe ist eine
  -- echte Top-Level-Aufgabe, kein Subtask) — der Skill rekonstruiert darüber den Familienbaum.
  followup_source_id uuid references tasks(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists tasks_parent_task_id_idx on tasks (parent_task_id);
create index if not exists tasks_watchlist_item_id_idx on tasks (watchlist_item_id);
create index if not exists tasks_followup_source_id_idx on tasks (followup_source_id);
create index if not exists tasks_followup_status_idx on tasks (followup_status);

-- Notizen/Kommentare zu Aufgaben (siehe wissensdatenbank/features/task-comments.md, Variante B) —
-- spontane Gedanken beim erneuten Betrachten einer Aufgabe, kein eigenes Bearbeitungsfeld.
create table if not exists task_comments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now()
);

create index if not exists task_comments_task_id_idx on task_comments (task_id);

-- Folgeaufgaben-Vorschläge (migration-027, wissensdatenbank/features/folgeaufgaben-vorschlaege.md):
-- aktuell offene Vorschläge zur Anzeige im "Neue Vorschläge"-Popup, bei jedem Skill-Lauf frisch
-- erzeugt (kein wiederkehrender Vorrat). effort mitführen → übernommene Aufgabe ist plan-tauglich.
create table if not exists task_followup_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  source_task_id uuid references tasks(id) on delete cascade not null,
  area_id uuid references areas on delete set null,
  title text not null,
  frame text,
  effort integer check (effort in (5, 10, 30, 60)),
  status text default 'open' check (status in ('open', 'muted', 'accepted', 'dismissed')),
  created_at timestamptz default now()
);

create index if not exists task_followup_suggestions_source_task_id_idx
  on task_followup_suggestions (source_task_id);
create index if not exists task_followup_suggestions_user_status_idx
  on task_followup_suggestions (user_id, status);

-- Weicher Themen-Dämpfer: wie oft ein Vorschlags-Thema angeboten-und-nie-gewählt wurde. Kein
-- Zähler, der Wiederholungen erzwingt — nur Dämpfer-Eingabe für den Skill. Nur der Skill greift zu.
create table if not exists followup_topic_tally (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  topic text not null,
  offered_count integer default 0,
  last_offered_at timestamptz,
  unique (user_id, topic)
);

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
  category text, -- freier Key in expense_categories (frei editierbar, kein festes Enum mehr; siehe migration-025)
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

-- Sparplan: Schulden — Bestand mit Resttilgung + optional Zins (siehe wissensdatenbank/
-- finanzen-erweiterungen/finanzplan-erweiterungen-v2.md, Punkt 6). Bewusst eine eigene Tabelle statt
-- committed_expenses (das ist ein Termin-Ereignis, keine laufende Restschuld). Vorrang-Logik
-- (Tilgung vor Wachstums-/Freiheit-Zuteilung) läuft im Weekly Review, nicht hier.
create table if not exists debts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  initial_amount numeric(10,2) not null,
  remaining_amount numeric(10,2) not null,
  interest_rate numeric(5,2),
  min_payment numeric(10,2),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Frei editierbare Ausgaben-Kategorien (siehe wissensdatenbank/finanzen-erweiterungen/
-- finanzplan-erweiterungen-v2.md, Punkt 9). transactions.category speichert den text-Key.
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

-- "Lesen als Bereich" — einfache Seiten-Variante (siehe wissensdatenbank/features/lesen-als-bereich.md).
create table if not exists books (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  author text,
  total_pages integer,
  current_page integer not null default 0,
  progress_unit text not null default 'chapters'
    check (progress_unit in ('pages', 'chapters')),
  total_chapters integer,
  current_chapter integer not null default 0,
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
  pages_read integer,
  chapters_read integer,
  created_at timestamptz default now()
);

-- Gaming-Backlog — manueller Bestand (siehe wissensdatenbank/features/gaming-backlog.md). Eigene
-- Tabelle statt Erweiterung von watchlist_items (kontinuierlicher Fortschritt, kein Wochenprogramm).
create table if not exists game_backlog_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  status text not null default 'backlog'
    check (status in ('wishlist','backlog','playing','paused','done','abandoned')),
  platform text,
  release_date date,
  progress_pct integer check (progress_pct is null or (progress_pct between 0 and 100)),
  priority text check (priority is null or priority in ('low','medium','high')),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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
-- übersprungen werden. kind unterscheidet echtes Schauen von einem manuell als "nicht geschaut"
-- markierten Abschluss (migration-017.sql).
create table if not exists watchlist_viewing_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  watchlist_item_id uuid references watchlist_items(id) on delete cascade not null,
  rating integer check (rating between 1 and 10),
  season integer,
  episode integer,
  kind text not null default 'watched' check (kind in ('watched', 'skipped')),
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

-- Zähl-Habits (mengen-basierte Habits, migration-026): eigene Log-Tabelle OHNE unique(task_id,date),
-- weil ein Zähl-Habit mehrere Taps/Zeilen pro Tag hat (habit_completions bleibt den binären Habits
-- vorbehalten). tasks.habit_unit markiert ein Zähl-Habit + hält das Einheiten-Label.
create table if not exists habit_counter_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  date date not null,
  amount numeric not null default 1,
  created_at timestamptz default now()
);

create index if not exists habit_counter_log_task_id_idx on habit_counter_log (task_id);

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

-- Digitaler Kühlschrank — manueller Bestand-Teil (migration-018.sql), automatische Befüllung aus
-- Kassenbon-Einzelpositionen folgt erst mit der OCR-Erfassung. amount als Freitext, analog
-- recipes.ingredients[].amount.
create table if not exists pantry_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  amount text,
  category text,
  expires_at date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists pantry_items_user_id_idx on pantry_items (user_id);

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
alter table debts enable row level security;
alter table expense_categories enable row level security;
alter table books enable row level security;
alter table book_reading_log enable row level security;
alter table game_backlog_items enable row level security;
alter table wishlist_items enable row level security;
alter table savings_pot_entries enable row level security;
alter table recipes enable row level security;
alter table task_comments enable row level security;
alter table task_followup_suggestions enable row level security;
alter table followup_topic_tally enable row level security;
alter table watchlist_items enable row level security;
alter table watchlist_viewing_log enable row level security;
alter table habit_completions enable row level security;
alter table habit_counter_log enable row level security;
alter table birthdays enable row level security;
alter table daily_reflections enable row level security;
alter table pantry_items enable row level security;

drop policy if exists "areas: own data" on areas;
create policy "areas: own data" on areas for all using (auth.uid() = user_id);

drop policy if exists "tasks: own data" on tasks;
create policy "tasks: own data" on tasks for all using (auth.uid() = user_id);

drop policy if exists "task_comments: own data" on task_comments;
create policy "task_comments: own data" on task_comments for all using (auth.uid() = user_id);

drop policy if exists "task_followup_suggestions: own data" on task_followup_suggestions;
create policy "task_followup_suggestions: own data" on task_followup_suggestions for all using (auth.uid() = user_id);

drop policy if exists "followup_topic_tally: own data" on followup_topic_tally;
create policy "followup_topic_tally: own data" on followup_topic_tally for all using (auth.uid() = user_id);

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

drop policy if exists "debts: own data" on debts;
create policy "debts: own data" on debts for all using (auth.uid() = user_id);

drop policy if exists "expense_categories: own data" on expense_categories;
create policy "expense_categories: own data" on expense_categories for all using (auth.uid() = user_id);

drop policy if exists "books: own data" on books;
create policy "books: own data" on books for all using (auth.uid() = user_id);

drop policy if exists "book_reading_log: own data" on book_reading_log;
create policy "book_reading_log: own data" on book_reading_log for all using (auth.uid() = user_id);

drop policy if exists "game_backlog_items: own data" on game_backlog_items;
create policy "game_backlog_items: own data" on game_backlog_items for all using (auth.uid() = user_id);

drop policy if exists "wishlist_items: own data" on wishlist_items;
create policy "wishlist_items: own data" on wishlist_items for all using (auth.uid() = user_id);

drop policy if exists "savings_pot_entries: own data" on savings_pot_entries;
create policy "savings_pot_entries: own data" on savings_pot_entries for all using (auth.uid() = user_id);

drop policy if exists "recipes: own data" on recipes;
create policy "recipes: own data" on recipes for all using (auth.uid() = user_id);

drop policy if exists "watchlist_items: own data" on watchlist_items;
create policy "watchlist_items: own data" on watchlist_items for all using (auth.uid() = user_id);

drop policy if exists "watchlist_viewing_log: own data" on watchlist_viewing_log;
create policy "watchlist_viewing_log: own data" on watchlist_viewing_log for all using (auth.uid() = user_id);

drop policy if exists "habit_completions: own data" on habit_completions;
create policy "habit_completions: own data" on habit_completions for all using (auth.uid() = user_id);

drop policy if exists "habit_counter_log: own data" on habit_counter_log;
create policy "habit_counter_log: own data" on habit_counter_log for all using (auth.uid() = user_id);

drop policy if exists "birthdays: own data" on birthdays;
create policy "birthdays: own data" on birthdays for all using (auth.uid() = user_id);

drop policy if exists "pantry_items: own data" on pantry_items;
create policy "pantry_items: own data" on pantry_items for all using (auth.uid() = user_id);

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

drop trigger if exists recipes_updated_at on recipes;
create trigger recipes_updated_at
  before update on recipes
  for each row execute function update_updated_at();

drop trigger if exists watchlist_items_updated_at on watchlist_items;
create trigger watchlist_items_updated_at
  before update on watchlist_items
  for each row execute function update_updated_at();

drop trigger if exists pantry_items_updated_at on pantry_items;
create trigger pantry_items_updated_at
  before update on pantry_items
  for each row execute function update_updated_at();
