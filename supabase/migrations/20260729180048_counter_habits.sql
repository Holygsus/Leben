alter table tasks add column if not exists habit_unit text;

create table if not exists habit_counter_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  date date not null,
  amount numeric not null default 1,
  created_at timestamptz default now()
);

create index if not exists habit_counter_log_task_id_idx on habit_counter_log (task_id);

alter table habit_counter_log enable row level security;
drop policy if exists "habit_counter_log: own data" on habit_counter_log;
create policy "habit_counter_log: own data" on habit_counter_log for all using (auth.uid() = user_id);