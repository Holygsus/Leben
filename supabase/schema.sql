-- Leben OS — Datenbankschema
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)

-- Lebensbereiche
create table if not exists areas (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  color text not null default '#888888',
  icon text,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- Projekte
create table if not exists projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  area_id uuid references areas on delete cascade,
  name text not null,
  color text,
  status text default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz default now()
);

-- Aufgaben
create table if not exists tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  area_id uuid references areas on delete set null,
  project_id uuid references projects on delete set null,
  title text not null,
  effort integer check (effort in (5, 10, 30, 60)),
  status text default 'open' check (status in ('open', 'planned', 'done')),
  planned_date date,
  is_brainstorm boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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

-- Module (für spätere Zahnräder)
create table if not exists modules (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  is_active boolean default false,
  settings jsonb default '{}',
  created_at timestamptz default now()
);

-- Row Level Security
alter table areas enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table daily_plans enable row level security;
alter table modules enable row level security;

drop policy if exists "areas: own data" on areas;
create policy "areas: own data" on areas for all using (auth.uid() = user_id);

drop policy if exists "projects: own data" on projects;
create policy "projects: own data" on projects for all using (auth.uid() = user_id);

drop policy if exists "tasks: own data" on tasks;
create policy "tasks: own data" on tasks for all using (auth.uid() = user_id);

drop policy if exists "daily_plans: own data" on daily_plans;
create policy "daily_plans: own data" on daily_plans for all using (auth.uid() = user_id);

drop policy if exists "modules: own data" on modules;
create policy "modules: own data" on modules for all using (auth.uid() = user_id);

-- Auto-Timestamp für tasks.updated_at
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
