-- Leben OS — Migration 036
-- Update 2026-10-04: via Supabase-MCP in sieben Schritten angewendet und live in der Produktions-DB
-- (watchlist_tv_extend_items_and_log, watchlist_tv_schedule_events_profile,
-- watchlist_tv_learning_and_scoring, watchlist_tv_build_week, watchlist_tv_fix_variety_nulls,
-- watchlist_tv_schnupper_no_films, watchlist_tv_autopilot_prep) — nicht erneut ausführen.
--
-- Diese Datei hält den daraus resultierenden Endstand in einem Stück fest (die Zwischenschritte
-- fix_variety_nulls und schnupper_no_films sind direkt in die finale View bzw. Funktion eingearbeitet).
--
-- Sender-Autopilot fürs Fernsehprogramm: statt tasks-Zeilen pro Tag (autoplanWatchlistForDates in
-- js/watchlist.js) baut build_broadcast_week() aus einem festen Sendeschema (broadcast_slots), dem
-- gelernten Interessenprofil und Terminen (watch_events) ein konkretes Programm (broadcast_program).
-- Signale aus dem Frontend landen als watchlist_viewing_log-Zeile mit program_entry_id; der Trigger
-- watch_learn_from_log hakt den Programmeintrag ab und lernt daraus.

-- ---------- 1) Watchlist-Items und Log erweitern ----------

alter table public.watchlist_items drop constraint watchlist_items_status_check;
alter table public.watchlist_items add constraint watchlist_items_status_check
  check (status = any (array['aktiv','geplant','irgendwann','beendet','wartet_auf_neue_staffel',
                             'kandidat','schnuppern','pausiert','abgesetzt']));

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
  add column if not exists last_scheduled_at timestamptz,
  add column if not exists enriched_at timestamptz;

create index if not exists watchlist_items_user_status_idx on public.watchlist_items (user_id, status);
alter table public.watchlist_items
  add constraint watchlist_items_user_tmdb_key unique (user_id, tmdb_media_type, tmdb_id);

alter table public.watchlist_viewing_log drop constraint watchlist_viewing_log_kind_check;
alter table public.watchlist_viewing_log add constraint watchlist_viewing_log_kind_check
  check (kind = any (array['watched','skipped','abandoned','binged','sample_keep','sample_drop','reaction']));
alter table public.watchlist_viewing_log
  add column if not exists program_entry_id uuid,
  add column if not exists reaction smallint check (reaction in (-1,1));

-- ---------- 2) Sendeschema, Termine, Programm, Interessenprofil ----------

-- Sendeschema: feste Slots pro Wochentag (1=Mo … 7=So)
create table public.broadcast_slots (
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
create table public.watch_events (
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
create index watch_events_user_time_idx on public.watch_events (user_id, starts_at);

-- Konkretes Programm (Ausstrahlungsplan)
create table public.broadcast_program (
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
create index broadcast_program_user_date_idx on public.broadcast_program (user_id, air_date);

alter table public.watchlist_viewing_log
  add constraint watchlist_viewing_log_program_fk
  foreign key (program_entry_id) references public.broadcast_program(id) on delete set null;

-- Interessenprofil
create table public.watch_interest_profile (
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
create policy "broadcast_slots: own data" on public.broadcast_slots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watch_events: own data" on public.watch_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "broadcast_program: own data" on public.broadcast_program for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
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
