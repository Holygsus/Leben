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

    for s in
      select * from public.broadcast_slots b
       where b.user_id = p_user and b.active and b.weekday = d + 1
       order by b.start_time
    loop
      if exists (
        select 1 from public.watch_events e
         where e.user_id = p_user and e.kind in ('sport','live','premiere')
           and (v_day + s.start_time)
               between (e.starts_at at time zone tz) - interval '30 minutes'
                   and coalesce(e.ends_at at time zone tz, (e.starts_at at time zone tz) + interval '2 hours')
      ) then continue; end if;

      if s.slot_kind in ('frei','live') then continue; end if;

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
                 when 'schnupper' then w.status in ('kandidat','geplant','irgendwann')
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