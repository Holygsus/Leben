create table if not exists expense_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  key text not null,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  unique (user_id, key)
);

alter table expense_categories enable row level security;
drop policy if exists "expense_categories: own data" on expense_categories;
create policy "expense_categories: own data" on expense_categories for all using (auth.uid() = user_id);

alter table transactions drop constraint if exists transactions_category_check;