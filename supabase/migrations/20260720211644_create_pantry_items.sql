create table if not exists pantry_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  amount text,
  category text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists pantry_items_user_id_idx on pantry_items (user_id);

drop trigger if exists pantry_items_updated_at on pantry_items;
create trigger pantry_items_updated_at
  before update on pantry_items
  for each row execute function update_updated_at();

alter table pantry_items enable row level security;
drop policy if exists "pantry_items: own data" on pantry_items;
create policy "pantry_items: own data" on pantry_items for all using (auth.uid() = user_id);