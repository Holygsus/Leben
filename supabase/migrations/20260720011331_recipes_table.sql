create table if not exists recipes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  ingredients jsonb not null default '[]',
  instructions text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists recipes_user_id_idx on recipes (user_id);

alter table recipes enable row level security;
drop policy if exists "recipes: own data" on recipes;
create policy "recipes: own data" on recipes for all using (auth.uid() = user_id);

drop trigger if exists recipes_updated_at on recipes;
create trigger recipes_updated_at
  before update on recipes
  for each row execute function update_updated_at();