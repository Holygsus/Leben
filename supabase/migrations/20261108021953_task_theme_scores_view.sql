-- Auftrag 09a878da (Planungsrunde 08.11.2026, Variante C): Bewertungs-Kennzahlen je Thema
-- (Mutteraufgabe = Wurzel über parent_task_id) für den Tagesplan-Vorschlag. Eine Zeile je nicht
-- erledigter Aufgabe mit den Werten ihres Themas. Die Score-Formel selbst rechnet js/planner.js.
-- RLS greift über security_invoker (tasks und task_feedback haben own-data-Policies).
create or replace view public.task_theme_scores with (security_invoker = true) as
with recursive fam as (
  select t.id, t.id as root_id from public.tasks t where t.parent_task_id is null
  union all
  select c.id, f.root_id from public.tasks c join fam f on c.parent_task_id = f.id
), stats as (
  select f.root_id,
    coalesce(sum(fb.rating), 0)::int as rating_sum,
    count(fb.id)::int as rating_count,
    coalesce(max(t.updated_at) filter (where t.status = 'done'), min(t.created_at)) as last_touched_at
  from fam f
  join public.tasks t on t.id = f.id
  left join public.task_feedback fb on fb.task_id = f.id
  group by f.root_id
)
select f.id as task_id, f.root_id, s.rating_sum, s.rating_count, s.last_touched_at
from fam f
join public.tasks t on t.id = f.id
join stats s on s.root_id = f.root_id
where t.status <> 'done';

comment on view public.task_theme_scores is
  'Je offene Aufgabe: Thema (root_id), Sternesumme, Anzahl Bewertungen und zuletzt erledigt im Thema (sonst Anlage). Score in js/planner.js.';
