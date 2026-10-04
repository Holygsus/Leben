-- Leben OS — Migration 027: Folgeaufgaben-Vorschläge nach Aufgaben-Abschluss
alter table tasks add column if not exists followup_status text
  check (followup_status in ('pending', 'suggested', 'closed'));

alter table tasks add column if not exists followup_source_id uuid references tasks(id) on delete set null;

create index if not exists tasks_followup_source_id_idx on tasks (followup_source_id);
create index if not exists tasks_followup_status_idx on tasks (followup_status);

create table if not exists task_followup_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  source_task_id uuid references tasks(id) on delete cascade not null,
  area_id uuid references areas on delete set null,
  title text not null,
  frame text,
  effort integer check (effort in (5, 10, 30, 60)),
  status text default 'open' check (status in ('open', 'accepted', 'dismissed')),
  created_at timestamptz default now()
);

create index if not exists task_followup_suggestions_source_task_id_idx
  on task_followup_suggestions (source_task_id);
create index if not exists task_followup_suggestions_user_status_idx
  on task_followup_suggestions (user_id, status);

create table if not exists followup_topic_tally (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  topic text not null,
  offered_count integer default 0,
  last_offered_at timestamptz,
  unique (user_id, topic)
);

alter table task_followup_suggestions enable row level security;
drop policy if exists "task_followup_suggestions: own data" on task_followup_suggestions;
create policy "task_followup_suggestions: own data" on task_followup_suggestions
  for all using (auth.uid() = user_id);

alter table followup_topic_tally enable row level security;
drop policy if exists "followup_topic_tally: own data" on followup_topic_tally;
create policy "followup_topic_tally: own data" on followup_topic_tally
  for all using (auth.uid() = user_id);