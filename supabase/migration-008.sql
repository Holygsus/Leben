-- Leben OS — Migration 008
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Watchlist/Fernsehprogramm: watchlist_items (Katalog) + watchlist_viewing_log (Bewertung je
-- Sichtung) + tasks.watchlist_item_id (Brücke zum Habit-Aufgaben-Pool-Mechanismus, siehe
-- js/watchlist.js). Terminierung läuft über tasks.planned_date (keine eigene scheduled_date-
-- Spalte hier), siehe wissensdatenbank/features/watchlist-fernsehprogramm.md.

create table if not exists watchlist_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  type text not null default 'serie' check (type in ('serie', 'anime', 'film')),
  genres text[] default '{}',
  -- 'geplant' als konservativer Default (analog wishlist_items.status='inactive'): ein frisch
  -- angelegter Eintrag nimmt erst an der wöchentlichen Rotation teil, wenn er explizit auf 'aktiv'
  -- gesetzt wird.
  status text not null default 'geplant'
    check (status in ('aktiv', 'geplant', 'irgendwann', 'beendet', 'wartet_auf_neue_staffel')),
  platform text,
  -- null = Typ-Standard greift (45/20/90 Min., siehe DEFAULT_DURATION_MIN in js/watchlist.js),
  -- gesetzt = manueller Override. Bewusst kein Default hier in der DB, sonst müsste ein
  -- Typwechsel nachträglich den Wert korrigieren statt einfach null zu bleiben.
  duration_minutes integer,
  current_season integer,
  current_episode integer,
  next_season_release_date date,
  -- Manuelle Rotationsreihenfolge, analog areas.sort_order — Grundlage für die Warteschlangen-
  -- Zuteilung in autoplanWatchlistForDates() (js/watchlist.js).
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists watchlist_items_user_status_idx on watchlist_items (user_id, status);

-- Sichtungs-Log: eine Zeile pro gesehener Episode/Film, Bewertung pro Sichtung statt pro Item
-- (eine schlecht bewertete Folge soll weder Priorität noch Rotation der Serie beeinflussen).
-- rating nullable — eine Sichtung wird immer geloggt (Task wurde erledigt), die Bewertung selbst
-- kann übersprungen werden.
create table if not exists watchlist_viewing_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  watchlist_item_id uuid references watchlist_items(id) on delete cascade not null,
  rating text check (rating in ('up', 'down')),
  season integer,
  episode integer,
  watched_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists watchlist_viewing_log_item_idx on watchlist_viewing_log (watchlist_item_id);

-- Brücke zum Habit-Aufgaben-Pool: eine tasks-Zeile mit gesetztem watchlist_item_id IST der Termin
-- im Fernsehprogramm (planned_date = geplanter Tag) — kein separates scheduled_date auf
-- watchlist_items, damit tasks.planned_date die einzige Quelle der Wahrheit für Terminierung
-- bleibt (daily_plans wird im Code nicht mehr gelesen, siehe js/app.js). on delete cascade, weil
-- eine offene "Watchlist schauen"-Aufgabe ohne ihr Item sinnlos ist (analog tasks.parent_task_id).
-- Achtung beim Anlegen solcher tasks-Zeilen: tasks.effort erlaubt nur 5/10/30/60 und passt nicht
-- zu den Watchlist-Dauern (45/20/90 Min.) — effort bleibt bei Watchlist-Tasks NULL, die
-- tatsächliche Dauer lebt ausschließlich in watchlist_items.duration_minutes.
alter table tasks add column if not exists watchlist_item_id uuid references watchlist_items(id) on delete cascade;
create index if not exists tasks_watchlist_item_id_idx on tasks (watchlist_item_id);

alter table watchlist_items enable row level security;
alter table watchlist_viewing_log enable row level security;

drop policy if exists "watchlist_items: own data" on watchlist_items;
create policy "watchlist_items: own data" on watchlist_items for all using (auth.uid() = user_id);

drop policy if exists "watchlist_viewing_log: own data" on watchlist_viewing_log;
create policy "watchlist_viewing_log: own data" on watchlist_viewing_log for all using (auth.uid() = user_id);

drop trigger if exists watchlist_items_updated_at on watchlist_items;
create trigger watchlist_items_updated_at
  before update on watchlist_items
  for each row execute function update_updated_at();
