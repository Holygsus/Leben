-- Lernen aus dem Viewing-Log (mit Komfortzonen-Regel)
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

-- Langsames Verblassen alter Interessen (wöchentlich aufrufen)
create or replace function public.watch_profile_decay(p_factor numeric default 0.95)
returns void language sql set search_path = public as $$
  update public.watch_interest_profile
     set weight = weight * p_factor
   where user_id = coalesce(auth.uid(), user_id);
$$;

-- Kandidaten mit Score
create or replace view public.watch_candidate_scores with (security_invoker = true) as
select i.*,
       coalesce(p.affinity, 0) as affinity,
       (coalesce(i.next_season_release_date, i.release_date)
          between current_date - 14 and current_date) as is_fresh_release,
       ( coalesce(p.affinity, 0)
         + case i.status when 'aktiv' then 2 when 'schnuppern' then 1.5 when 'geplant' then 0.5
                         when 'irgendwann' then -1 else 0 end
         + case when i.source = 'selbst' then 0.75 * i.skip_streak else -0.75 * i.skip_streak end
         + case when coalesce(i.next_season_release_date, i.release_date)
                     between current_date - 14 and current_date then 3 else 0 end
         - case when i.last_scheduled_at > now() - interval '2 days' then 2 else 0 end
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
