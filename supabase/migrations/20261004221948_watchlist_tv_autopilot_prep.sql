alter table public.watchlist_items add column if not exists enriched_at timestamptz;

drop index if exists public.watchlist_items_user_tmdb_uidx;
alter table public.watchlist_items
  add constraint watchlist_items_user_tmdb_key unique (user_id, tmdb_media_type, tmdb_id);

drop index if exists public.watch_events_ext_uidx;
alter table public.watch_events
  add constraint watch_events_user_source_ref_key unique (user_id, source, external_ref);

create extension if not exists pg_cron;

-- Sonntag 18:00 (Berlin, Winterzeit ≈ 17:00 UTC): Profil altern lassen, Programm der nächsten Woche bauen
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