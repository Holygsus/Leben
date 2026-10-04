-- Status erweitern (bestehende Werte bleiben gültig)
alter table public.watchlist_items drop constraint watchlist_items_status_check;
alter table public.watchlist_items add constraint watchlist_items_status_check
  check (status = any (array['aktiv','geplant','irgendwann','beendet','wartet_auf_neue_staffel',
                             'kandidat','schnuppern','pausiert','abgesetzt']));

-- Neue Spalten
alter table public.watchlist_items
  add column if not exists source text not null default 'selbst'
    check (source in ('selbst','vorschlag')),
  add column if not exists suggestion_reason text,
  add column if not exists tmdb_id integer,
  add column if not exists tmdb_media_type text check (tmdb_media_type in ('movie','tv')),
  add column if not exists release_date date,
  add column if not exists trailer_url text,
  add column if not exists mood text check (mood in ('leicht','mittel','schwer')),
  add column if not exists tags text[] not null default '{}',
  add column if not exists people text[] not null default '{}',
  add column if not exists dropped_reason text
    check (dropped_reason in ('format_passt_nicht','interesse_erloschen','quote')),
  add column if not exists skip_streak integer not null default 0,
  add column if not exists last_scheduled_at timestamptz;

create index if not exists watchlist_items_user_status_idx on public.watchlist_items (user_id, status);
create unique index if not exists watchlist_items_user_tmdb_uidx
  on public.watchlist_items (user_id, tmdb_media_type, tmdb_id) where tmdb_id is not null;

-- Log: neue Signalarten
alter table public.watchlist_viewing_log drop constraint watchlist_viewing_log_kind_check;
alter table public.watchlist_viewing_log add constraint watchlist_viewing_log_kind_check
  check (kind = any (array['watched','skipped','abandoned','binged','sample_keep','sample_drop','reaction']));
alter table public.watchlist_viewing_log
  add column if not exists program_entry_id uuid,
  add column if not exists reaction smallint check (reaction in (-1,1));
