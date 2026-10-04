create table if not exists game_backlog_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  status text not null default 'backlog'
    check (status in ('wishlist','backlog','playing','paused','done','abandoned')),
  platform text,
  release_date date,
  progress_pct integer check (progress_pct is null or (progress_pct between 0 and 100)),
  priority text check (priority is null or priority in ('low','medium','high')),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table game_backlog_items enable row level security;
drop policy if exists "game_backlog_items: own data" on game_backlog_items;
create policy "game_backlog_items: own data" on game_backlog_items for all using (auth.uid() = user_id);