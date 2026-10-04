-- 1. trips wird zur Bucket List
alter table public.trips drop constraint trips_status_check;
alter table public.trips add constraint trips_status_check
  check (status = any (array['traum','geplant','gebucht','aktiv','abgeschlossen','verworfen']));

alter table public.trips
  add column kind text not null default 'ort' check (kind in ('ort','event')),
  add column country text,
  add column season_months int[] check (season_months is null or season_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]),
  add column budget_target numeric,
  add column priority int check (priority in (1,2,3)),
  add column rating int check (rating between 1 and 10),
  add column reflection text,
  add column source_thought_id uuid references public.thoughts(id) on delete set null;

-- 2. Reisebuero-Varianten
create table public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  trip_id uuid not null references public.trips(id) on delete cascade,
  label text not null,
  summary text,
  duration_days int,
  budget_estimate numeric,
  best_period text,
  details jsonb not null default '{}'::jsonb,
  chosen boolean not null default false,
  created_at timestamptz default now()
);
create unique index trip_plans_one_chosen on public.trip_plans(trip_id) where chosen;
create index trip_plans_trip_idx on public.trip_plans(trip_id);
alter table public.trip_plans enable row level security;
create policy "trip_plans: own data" on public.trip_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.trips add column chosen_plan_id uuid references public.trip_plans(id) on delete set null;

-- 3./4. Verknuepfungen zu Tasks und Geld
alter table public.tasks add column trip_id uuid references public.trips(id) on delete set null;
alter table public.savings_pot_entries add column trip_id uuid references public.trips(id) on delete set null;
alter table public.committed_expenses add column trip_id uuid references public.trips(id) on delete set null;
create index tasks_trip_idx on public.tasks(trip_id) where trip_id is not null;
create index savings_trip_idx on public.savings_pot_entries(trip_id) where trip_id is not null;
create index committed_trip_idx on public.committed_expenses(trip_id) where trip_id is not null;

-- 5. Uebersicht fuer App + Weekly Review (RLS greift via security_invoker)
create view public.trip_overview with (security_invoker = true) as
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
  -- Monate bis sich das Saisonfenster oeffnet (0 = jetzt offen)
  (select min(((mo - extract(month from current_date)::int) + 12) % 12)
     from unnest(t.season_months) mo) as months_until_window,
  -- Anteil verstrichener Zeit zwischen Erstellung und Abreise
  case when t.date_from is not null and t.date_from > t.created_at::date then
    round(least(1, greatest(0, (current_date - t.created_at::date)::numeric
          / nullif(t.date_from - t.created_at::date, 0))) * 100)
  end as time_elapsed_pct
from public.trips t
left join (select trip_id, sum(amount) saved from public.savings_pot_entries group by trip_id) s on s.trip_id = t.id
left join (select trip_id,
             count(*) filter (where status <> 'done') open_milestones,
             count(*) filter (where status <> 'done' and planned_date < current_date) overdue_milestones,
             min(planned_date) filter (where status <> 'done') next_milestone_date
           from public.tasks where trip_id is not null group by trip_id) m on m.trip_id = t.id
left join (select trip_id, sum(amount) open_commitments from public.committed_expenses
           where status = 'open' group by trip_id) c on c.trip_id = t.id;