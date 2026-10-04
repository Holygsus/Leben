create table if not exists task_feedback (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  rating int not null check (rating between 1 and 5),
  note text,
  created_at timestamptz default now(),
  unique (task_id)
);

create index if not exists task_feedback_user_id_idx on task_feedback (user_id);

alter table task_feedback enable row level security;

drop policy if exists "task_feedback: own data" on task_feedback;
create policy "task_feedback: own data" on task_feedback for all using (auth.uid() = user_id);