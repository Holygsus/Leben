-- Leben OS — Migration 009
-- Habit Tracker V2: Wiederholungsintervall (habit_recurrence + habit_last_due_date) und
-- Streak-Tracking-Fundament (habit_completions). Aufgaben-Pool braucht keine Schemaänderung
-- (nutzt bestehendes tasks.parent_task_id).

alter table tasks add column if not exists habit_recurrence text default 'weekly'
  check (habit_recurrence in ('weekly', 'biweekly', 'monthly'));

alter table tasks add column if not exists habit_last_due_date date;

create table if not exists habit_completions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  date date not null,
  created_at timestamptz default now(),
  unique (task_id, date)
);

create index if not exists habit_completions_task_id_idx on habit_completions (task_id);

alter table habit_completions enable row level security;

drop policy if exists "habit_completions: own data" on habit_completions;
create policy "habit_completions: own data" on habit_completions for all using (auth.uid() = user_id);
