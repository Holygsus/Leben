-- Leben OS — Migration 001
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
-- Behebt doppelte Bereiche und legt das Fundament für verschachtelte Projekte.

-- 1. Doppelte Bereiche deduplizieren
--    Pro (user_id, name) den ältesten Bereich behalten, Referenzen umbiegen, Rest löschen.
with ranked as (
  select
    id,
    row_number() over (partition by user_id, name order by created_at, id) as rn,
    first_value(id) over (partition by user_id, name order by created_at, id) as keep_id
  from areas
)
update tasks t
set area_id = r.keep_id
from ranked r
where t.area_id = r.id and r.rn > 1;

with ranked as (
  select
    id,
    row_number() over (partition by user_id, name order by created_at, id) as rn,
    first_value(id) over (partition by user_id, name order by created_at, id) as keep_id
  from areas
)
update projects p
set area_id = r.keep_id
from ranked r
where p.area_id = r.id and r.rn > 1;

with ranked as (
  select
    id,
    row_number() over (partition by user_id, name order by created_at, id) as rn
  from areas
)
delete from areas a
using ranked r
where a.id = r.id and r.rn > 1;

-- 2. Doppelung künftig DB-seitig verhindern
alter table areas
  add constraint areas_user_name_unique unique (user_id, name);

-- 3. Fundament für verschachtelte Projekte / Projekt-Markierung
alter table projects
  add column if not exists parent_project_id uuid references projects(id) on delete cascade;

alter table projects
  add column if not exists is_project boolean default false;
