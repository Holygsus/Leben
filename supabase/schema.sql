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
  -- kandidat/schnuppern/pausiert/abgesetzt seit migration-036.sql (Sender-Autopilot).
  status text not null default 'geplant'
    check (status in ('aktiv', 'geplant', 'irgendwann', 'beendet', 'wartet_auf_neue_staffel',
                      'kandidat', 'schnuppern', 'pausiert', 'abgesetzt')),
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
  -- Ab hier migration-036.sql: Herkunft/Metadaten fürs Scoring in build_broadcast_week.
  source text not null default 'selbst' check (source in ('selbst', 'vorschlag')),
  suggestion_reason text,
  tmdb_id integer,
  tmdb_media_type text check (tmdb_media_type in ('movie', 'tv')),
  release_date date,
  trailer_url text,
  mood text check (mood in ('leicht', 'mittel', 'schwer')),
  tags text[] not null default '{}',
  people text[] not null default '{}',
  dropped_reason text check (dropped_reason in ('format_passt_nicht', 'interesse_erloschen', 'quote')),
  skip_streak integer not null default 0,
  last_scheduled_at timestamptz,
  enriched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint watchlist_items_user_tmdb_key unique (user_id, tmdb_media_type, tmdb_id)
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
  habit_daily_goal numeric,
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
  monthly_budget numeric,
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

-- Reiseplanung (siehe wissensdatenbank/features/reiseplanung.md) — eigener Tab, Pool→Tage-Modell
create table if not exists trips (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  destination text,
  date_from date,
  date_to date,
  status text not null default 'geplant'
    check (status in ('geplant','aktiv','abgeschlossen')),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists trip_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  trip_id uuid references trips on delete cascade not null,
  title text not null,
  status text not null default 'kandidat'
    check (status in ('kandidat','eingeplant','erledigt')),
  day_number integer,
  time_slot text check (time_slot is null or time_slot in ('vormittag','nachmittag','abend')),
  category text,
  notes text,
  link text,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists trip_items_trip_id_idx on trip_items (trip_id);

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
  kind text not null default 'watched'
    check (kind in ('watched', 'skipped', 'abandoned', 'binged', 'sample_keep', 'sample_drop', 'reaction')),
  -- migration-036.sql: Bezug zum Programmeintrag (FK unten im Sender-Autopilot-Block, weil
  -- broadcast_program erst dort angelegt wird) und Daumen-Reaktion.
  program_entry_id uuid,
  reaction smallint check (reaction in (-1, 1)),
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
  skipped boolean default false,   -- true = explizit als "nicht gemacht" markiert (migration-026)
  note text,                        -- optionale Kontext-Notiz zum Skip (migration-026)
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

-- Gedanken-Eingang (migration-032, wissensdatenbank/leben-os-betriebsmodell.md): rohes, noch
-- UNklassifiziertes Material — bewusst KEINE Aufgabe (das ist tasks.is_brainstorm). Der Daily Pulse
-- liest `status='raw'`, klassifiziert/routet und setzt `status='processed'` + Ergebnisverweis
-- (resulted_in_task_id bzw. routing_note), ohne die Zeile zu löschen (Nachvollziehbarkeit/Korrektur).
create table if not exists thoughts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  body text not null,
  status text not null default 'raw' check (status in ('raw', 'processed', 'unclear')),
  resulted_in_task_id uuid references tasks(id) on delete set null,
  routing_note text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create index if not exists thoughts_user_status_idx on thoughts (user_id, status);

-- Task-Feedback (migration-033, wissensdatenbank/leben-os-betriebsmodell.md): leichtes Rating (1–5,
-- wie daily_reflections.mood) + optionale Notiz beim Abschluss einer Aufgabe. Lern-Treibstoff für den
-- Folgeaufgaben-Familienbaum; die Notiz trägt das Ergebnis weiter. unique(task_id) = ein Feedback pro
-- Aufgabe. Habits/Watchlist App-seitig ausgenommen.
create table if not exists task_feedback (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  rating int not null check (rating between 1 and 5),
  note text,
  created_at timestamptz default now(),
  unique (task_id)
);

create index if not exists task_feedback_user_id_idx on task_feedback (user_id);

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
alter table trips enable row level security;
alter table trip_items enable row level security;
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
alter table thoughts enable row level security;
alter table task_feedback enable row level security;

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

drop policy if exists "trips: own data" on trips;
create policy "trips: own data" on trips for all using (auth.uid() = user_id);

drop policy if exists "trip_items: own data" on trip_items;
create policy "trip_items: own data" on trip_items for all using (auth.uid() = user_id);

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

drop policy if exists "thoughts: own data" on thoughts;
create policy "thoughts: own data" on thoughts for all using (auth.uid() = user_id);

drop policy if exists "task_feedback: own data" on task_feedback;
create policy "task_feedback: own data" on task_feedback for all using (auth.uid() = user_id);

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

-- =====================================================================================
-- Sender-Autopilot fürs Fernsehprogramm (migration-036.sql)
-- build_broadcast_week() baut aus broadcast_slots + watch_candidate_scores + watch_events das
-- Programm (broadcast_program); Signale kommen als watchlist_viewing_log-Zeile mit program_entry_id
-- zurück, der Trigger watch_learn_from_log pflegt Status, skip_streak und watch_interest_profile.
-- =====================================================================================

-- ---------- 2) Sendeschema, Termine, Programm, Interessenprofil ----------

-- Sendeschema: feste Slots pro Wochentag (1=Mo … 7=So)
create table if not exists public.broadcast_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  slot_name text not null,
  slot_kind text not null check (slot_kind in
    ('stamm','film','doku','schnupper','premiere','live','vorschau','wiederholung','frei')),
  theme_types text[] not null default '{}',   -- z.B. {doku}, {serie,anime}
  theme_genres text[] not null default '{}',
  max_minutes integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, weekday, start_time)
);

-- Termine: Sport, Live-Events, Premieren, Releases, Trailer
create table if not exists public.watch_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  kind text not null check (kind in ('sport','live','premiere','release','trailer')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  watchlist_item_id uuid references public.watchlist_items(id) on delete set null,
  competition text,                 -- Liga/Turnier
  url text,                         -- Trailer- oder Stream-Link
  priority smallint not null default 0,
  source text not null default 'manuell' check (source in ('manuell','tmdb','kalender','claude')),
  external_ref text,
  created_at timestamptz not null default now(),
  constraint watch_events_user_source_ref_key unique (user_id, source, external_ref)
);
create index if not exists watch_events_user_time_idx on public.watch_events (user_id, starts_at);

-- Konkretes Programm (Ausstrahlungsplan)
create table if not exists public.broadcast_program (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  air_date date not null,
  start_time time not null,
  slot_id uuid references public.broadcast_slots(id) on delete set null,
  slot_kind text not null,
  watchlist_item_id uuid references public.watchlist_items(id) on delete cascade,
  event_id uuid references public.watch_events(id) on delete cascade,
  reason text,
  status text not null default 'geplant' check (status in ('geplant','gesehen','uebersprungen','verdraengt')),
  created_at timestamptz not null default now(),
  check (watchlist_item_id is not null or event_id is not null)
);
create index if not exists broadcast_program_user_date_idx on public.broadcast_program (user_id, air_date);

alter table public.watchlist_viewing_log drop constraint if exists watchlist_viewing_log_program_fk;
alter table public.watchlist_viewing_log
  add constraint watchlist_viewing_log_program_fk
  foreign key (program_entry_id) references public.broadcast_program(id) on delete set null;

-- Interessenprofil
create table if not exists public.watch_interest_profile (
  user_id uuid not null default auth.uid(),
  dimension text not null check (dimension in ('genre','tag','mood','type','person')),
  value text not null,
  weight numeric not null default 0,
  signals integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, dimension, value)
);

alter table public.broadcast_slots enable row level security;
alter table public.watch_events enable row level security;
alter table public.broadcast_program enable row level security;
alter table public.watch_interest_profile enable row level security;
drop policy if exists "broadcast_slots: own data" on public.broadcast_slots;
create policy "broadcast_slots: own data" on public.broadcast_slots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "watch_events: own data" on public.watch_events;
create policy "watch_events: own data" on public.watch_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "broadcast_program: own data" on public.broadcast_program;
create policy "broadcast_program: own data" on public.broadcast_program for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "watch_interest_profile: own data" on public.watch_interest_profile;
create policy "watch_interest_profile: own data" on public.watch_interest_profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 3) Lernen aus dem Viewing-Log (mit Komfortzonen-Regel) ----------

create or replace function public.watch_learn_from_log()
returns trigger language plpgsql set search_path = public as $$
declare
  it public.watchlist_items%rowtype;
  d numeric;
begin
  select * into it from public.watchlist_items where id = new.watchlist_item_id;
  if not found then return new; end if;

  -- Programmeintrag abhaken
  if new.program_entry_id is not null then
    update public.broadcast_program
       set status = case when new.kind = 'skipped' then 'uebersprungen' else 'gesehen' end
     where id = new.program_entry_id;
  end if;

  -- Skip-Serie zählen bzw. zurücksetzen
  if new.kind = 'skipped' then
    update public.watchlist_items set skip_streak = skip_streak + 1 where id = it.id;
  elsif new.kind in ('watched','binged','sample_keep') then
    update public.watchlist_items set skip_streak = 0 where id = it.id;
  end if;

  -- Schnupper-Entscheidung setzt Status
  if new.kind = 'sample_keep' then
    update public.watchlist_items set status = 'aktiv' where id = it.id;
  elsif new.kind = 'sample_drop' then
    update public.watchlist_items
       set status = 'abgesetzt', dropped_reason = coalesce(dropped_reason, 'format_passt_nicht')
     where id = it.id;
  end if;

  -- Komfortzonen-Regel: Selbst eingetragenes wird durch Überspringen/Abbrechen NICHT abgewertet
  if it.source = 'selbst' and new.kind in ('skipped','abandoned') then
    return new;
  end if;

  d := case new.kind
         when 'watched'     then 1 + coalesce((new.rating - 5.5) / 4.5, 0)
         when 'binged'      then 2
         when 'abandoned'   then -1
         when 'skipped'     then -0.5
         when 'sample_keep' then 1.5
         when 'sample_drop' then -1.5
         when 'reaction'    then coalesce(new.reaction, 0)
         else 0 end;
  if d = 0 then return new; end if;

  insert into public.watch_interest_profile (user_id, dimension, value, weight, signals)
  select distinct on (f.dim, f.val) new.user_id, f.dim, f.val, d, 1
  from (
    select 'genre'::text dim, unnest(it.genres) val
    union all select 'tag', unnest(it.tags)
    union all select 'person', unnest(it.people)
    union all select 'type', it.type
    union all select 'mood', it.mood
  ) f
  where f.val is not null and f.val <> ''
  on conflict (user_id, dimension, value) do update
    set weight = public.watch_interest_profile.weight + excluded.weight,
        signals = public.watch_interest_profile.signals + 1,
        updated_at = now();
  return new;
end $$;

drop trigger if exists watchlist_viewing_log_learn on public.watchlist_viewing_log;
create trigger watchlist_viewing_log_learn
after insert on public.watchlist_viewing_log
for each row execute function public.watch_learn_from_log();

-- Langsames Verblassen alter Interessen (wöchentlich per pg_cron, siehe unten)
create or replace function public.watch_profile_decay(p_factor numeric default 0.95)
returns void language sql set search_path = public as $$
  update public.watch_interest_profile
     set weight = weight * p_factor
   where user_id = coalesce(auth.uid(), user_id);
$$;

-- ---------- 4) Kandidaten mit Score ----------

create or replace view public.watch_candidate_scores with (security_invoker = true) as
select i.*,
       coalesce(p.affinity, 0) as affinity,
       coalesce(coalesce(i.next_season_release_date, i.release_date)
          between current_date - 14 and current_date, false) as is_fresh_release,
       ( coalesce(p.affinity, 0)
         + case i.status when 'aktiv' then 2 when 'schnuppern' then 1.5 when 'geplant' then 0.5
                         when 'irgendwann' then -1 else 0 end
         + case when i.source = 'selbst' then 0.75 * i.skip_streak else -0.75 * i.skip_streak end
         + case when coalesce(i.next_season_release_date, i.release_date)
                     between current_date - 14 and current_date then 3 else 0 end
       ) as score
from public.watchlist_items i
left join lateral (
  select avg(w.weight) as affinity
  from public.watch_interest_profile w
  where w.user_id = i.user_id
    and (   (w.dimension = 'genre'  and w.value = any(i.genres))
         or (w.dimension = 'tag'    and w.value = any(i.tags))
         or (w.dimension = 'person' and w.value = any(i.people))
         or (w.dimension = 'type'   and w.value = i.type)
         or (w.dimension = 'mood'   and w.value = i.mood))
) p on true
where i.status in ('aktiv','schnuppern','geplant','kandidat','irgendwann')
   or (i.status = 'wartet_auf_neue_staffel' and i.next_season_release_date <= current_date);

-- ---------- 5) Wochenprogramm bauen ----------

create or replace function public.build_broadcast_week(
  p_week_start date default (date_trunc('week', now() at time zone 'Europe/Berlin'))::date,
  p_user uuid default auth.uid()
) returns integer language plpgsql set search_path = public as $$
declare
  tz constant text := 'Europe/Berlin';
  d int; v_day date; s record; ev record; c record;
  n int := 0; prev_mood text; v_reason text;
  used uuid[] := '{}'; day_used uuid[];
begin
  if p_user is null then raise exception 'build_broadcast_week: kein User'; end if;

  delete from public.broadcast_program
   where user_id = p_user and status = 'geplant'
     and air_date between p_week_start and p_week_start + 6;

  for d in 0..6 loop
    v_day := p_week_start + d;
    prev_mood := null;
    day_used := '{}';

    -- Termine haben Vorrang
    for ev in
      select * from public.watch_events e
       where e.user_id = p_user and e.kind in ('sport','live','premiere')
         and (e.starts_at at time zone tz)::date = v_day
       order by e.starts_at
    loop
      insert into public.broadcast_program
        (user_id, air_date, start_time, slot_kind, event_id, watchlist_item_id, reason)
      values (p_user, v_day, (ev.starts_at at time zone tz)::time,
              case when ev.kind = 'premiere' then 'premiere' else 'live' end,
              ev.id, ev.watchlist_item_id,
              case ev.kind when 'sport' then 'Live: ' || coalesce(ev.competition, 'Sport')
                           when 'live' then 'Live-Event' else 'Premiere' end);
      n := n + 1;
    end loop;

    -- Reguläre Slots
    for s in
      select * from public.broadcast_slots b
       where b.user_id = p_user and b.active and b.weekday = d + 1
       order by b.start_time
    loop
      -- durch Termin verdrängt?
      if exists (
        select 1 from public.watch_events e
         where e.user_id = p_user and e.kind in ('sport','live','premiere')
           and (v_day + s.start_time)
               between (e.starts_at at time zone tz) - interval '30 minutes'
                   and coalesce(e.ends_at at time zone tz, (e.starts_at at time zone tz) + interval '2 hours')
      ) then continue; end if;

      if s.slot_kind in ('frei','live') then continue; end if;

      -- Vorschau-Block: bis zu 4 Trailer, die noch nie liefen
      if s.slot_kind = 'vorschau' then
        for ev in
          select * from public.watch_events e
           where e.user_id = p_user and e.kind = 'trailer'
             and e.starts_at < ((v_day + 1)::timestamp at time zone tz)
             and not exists (select 1 from public.broadcast_program bp where bp.event_id = e.id)
           order by e.priority desc, e.starts_at desc
           limit 4
        loop
          insert into public.broadcast_program
            (user_id, air_date, start_time, slot_id, slot_kind, event_id, watchlist_item_id, reason)
          values (p_user, v_day, s.start_time, s.id, 'vorschau', ev.id, ev.watchlist_item_id, 'Trailer');
          n := n + 1;
        end loop;
        continue;
      end if;

      -- Wiederholung: Bestbewertetes aus Beendetem
      if s.slot_kind = 'wiederholung' then
        select i.id, i.mood
          into c
          from public.watchlist_items i
          join public.watchlist_viewing_log l on l.watchlist_item_id = i.id
         where i.user_id = p_user and i.status = 'beendet' and not (i.id = any(used))
         group by i.id
        having avg(l.rating) >= 7
         order by random() limit 1;
        if not found then continue; end if;
        v_reason := 'Wiederholung eines Lieblings';
      else
        select * into c
          from public.watch_candidate_scores w
         where w.user_id = p_user
           and not (w.id = any(used) and w.type in ('film','doku','youtube'))
           and (cardinality(s.theme_types) = 0 or w.type = any(s.theme_types))
           and (cardinality(s.theme_genres) = 0 or w.genres && s.theme_genres)
           and (s.max_minutes is null or w.duration_minutes is null or w.duration_minutes <= s.max_minutes)
           and case s.slot_kind
                 when 'schnupper' then w.type <> 'film' and w.status in ('kandidat','geplant','irgendwann')
                      and not exists (select 1 from public.watchlist_viewing_log l where l.watchlist_item_id = w.id)
                 when 'stamm'    then w.status in ('aktiv','schnuppern') or w.is_fresh_release
                 when 'premiere' then w.is_fresh_release
                 else true end
           and not (coalesce(prev_mood, '') = 'schwer' and coalesce(w.mood, '') = 'schwer')
         order by (w.id = any(day_used)),
                  (w.id = any(used)),
                  w.score + random() * case when s.slot_kind = 'schnupper' then 2 else 0.5 end desc
         limit 1;
        if not found then continue; end if;

        v_reason := case
          when c.is_fresh_release then 'Neu erschienen'
          when c.source = 'selbst' and c.skip_streak >= 2
            then 'Selbst eingetragen, ' || c.skip_streak || 'x übersprungen – kommt wieder'
          when s.slot_kind = 'schnupper' then 'Schnupperfolge' || coalesce(': ' || c.suggestion_reason, '')
          when c.affinity > 0.5 then 'Passt zu deinem Profil'
          when c.status = 'aktiv' then 'Laufende Serie'
          else 'Aus deiner Watchlist' end;
      end if;

      insert into public.broadcast_program
        (user_id, air_date, start_time, slot_id, slot_kind, watchlist_item_id, reason)
      values (p_user, v_day, s.start_time, s.id, s.slot_kind, c.id, v_reason);
      update public.watchlist_items set last_scheduled_at = now() where id = c.id;

      used := used || c.id;
      day_used := day_used || c.id;
      prev_mood := c.mood;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- ---------- 6) Autopilot ----------

create extension if not exists pg_cron;

-- Sonntag 17:00 UTC (≈ 18/19 Uhr Berlin): Profil altern lassen, Programm der nächsten Woche bauen
select cron.schedule(
  'watchlist_weekly_program',
  '0 17 * * 0',
  $c$
    select public.watch_profile_decay(0.95);
    select public.build_broadcast_week(
      (date_trunc('week', now() at time zone 'Europe/Berlin'))::date + 7, u.user_id)
    from (select distinct user_id from public.broadcast_slots) u;
  $c$
);

-- ============================================================================
-- Reise-Bucket-List (Migration 20261004224005_travel_bucket_list)
-- trips wird zur Bucket List; hier am Dateiende, weil die Verknüpfungen thoughts, tasks,
-- savings_pot_entries und committed_expenses voraussetzen (alle weiter oben definiert).
-- ============================================================================

-- 1) trips erweitern (Status-Check ersetzt den obigen Basis-Check)
alter table trips drop constraint if exists trips_status_check;
alter table trips add constraint trips_status_check
  check (status = any (array['traum','geplant','gebucht','aktiv','abgeschlossen','verworfen']));

alter table trips
  add column if not exists kind text not null default 'ort' check (kind in ('ort','event')),
  add column if not exists country text,
  add column if not exists season_months int[] check (season_months is null or season_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]),
  add column if not exists budget_target numeric,
  add column if not exists priority int check (priority in (1,2,3)),
  add column if not exists rating int check (rating between 1 and 10),
  add column if not exists reflection text,
  add column if not exists source_thought_id uuid references thoughts(id) on delete set null;

-- 2) Reisebüro-Varianten
create table if not exists trip_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  trip_id uuid not null references trips(id) on delete cascade,
  label text not null,
  summary text,
  duration_days int,
  budget_estimate numeric,
  best_period text,
  details jsonb not null default '{}'::jsonb,
  chosen boolean not null default false,
  created_at timestamptz default now()
);

create unique index if not exists trip_plans_one_chosen on trip_plans (trip_id) where chosen;
create index if not exists trip_plans_trip_idx on trip_plans (trip_id);

alter table trip_plans enable row level security;
drop policy if exists "trip_plans: own data" on trip_plans;
create policy "trip_plans: own data" on trip_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table trips add column if not exists chosen_plan_id uuid references trip_plans(id) on delete set null;

-- 3) Verknüpfungen zu Tasks und Geld
alter table tasks add column if not exists trip_id uuid references trips(id) on delete set null;
alter table savings_pot_entries add column if not exists trip_id uuid references trips(id) on delete set null;
alter table committed_expenses add column if not exists trip_id uuid references trips(id) on delete set null;
create index if not exists tasks_trip_idx on tasks (trip_id) where trip_id is not null;
create index if not exists savings_trip_idx on savings_pot_entries (trip_id) where trip_id is not null;
create index if not exists committed_trip_idx on committed_expenses (trip_id) where trip_id is not null;

-- 4) Übersicht für App + Weekly Review (RLS greift via security_invoker)
create or replace view public.trip_overview with (security_invoker = true) as
select
  t.id, t.user_id, t.title, t.destination, t.country, t.kind, t.status,
  t.date_from, t.date_to, t.season_months, t.budget_target, t.priority,
  t.created_at, t.updated_at,
  coalesce(s.saved, 0) as saved,
  case when t.budget_target > 0 then round(coalesce(s.saved,0) / t.budget_target * 100) end as saved_pct,
  coalesce(m.open_milestones, 0) as open_milestones,
  coalesce(m.overdue_milestones, 0) as overdue_milestones,
  m.next_milestone_date,
  coalesce(c.open_commitments, 0) as open_commitments,
  -- Monate bis sich das Saisonfenster öffnet (0 = jetzt offen)
  (select min(((mo - extract(month from current_date)::int) + 12) % 12)
     from unnest(t.season_months) mo) as months_until_window,
  -- Anteil verstrichener Zeit zwischen Erstellung und Abreise
  case when t.date_from is not null and t.date_from > t.created_at::date then
    round(least(1, greatest(0, (current_date - t.created_at::date)::numeric
          / nullif(t.date_from - t.created_at::date, 0))) * 100)
  end as time_elapsed_pct
from trips t
left join (select trip_id, sum(amount) saved from savings_pot_entries group by trip_id) s on s.trip_id = t.id
left join (select trip_id,
             count(*) filter (where status <> 'done') open_milestones,
             count(*) filter (where status <> 'done' and planned_date < current_date) overdue_milestones,
             min(planned_date) filter (where status <> 'done') next_milestone_date
           from tasks where trip_id is not null group by trip_id) m on m.trip_id = t.id
left join (select trip_id, sum(amount) open_commitments from committed_expenses
           where status = 'open' group by trip_id) c on c.trip_id = t.id;
