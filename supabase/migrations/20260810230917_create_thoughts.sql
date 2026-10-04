create table if not exists thoughts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  body text not null,
  status text not null default 'raw' check (status in ('raw', 'processed')),
  resulted_in_task_id uuid references tasks(id) on delete set null,
  routing_note text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create index if not exists thoughts_user_status_idx on thoughts (user_id, status);

alter table thoughts enable row level security;

drop policy if exists "thoughts: own data" on thoughts;
create policy "thoughts: own data" on thoughts for all using (auth.uid() = user_id);