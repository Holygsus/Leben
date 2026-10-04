create table if not exists debts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  initial_amount numeric(10,2) not null,
  remaining_amount numeric(10,2) not null,
  interest_rate numeric(5,2),
  min_payment numeric(10,2),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table debts enable row level security;
drop policy if exists "debts: own data" on debts;
create policy "debts: own data" on debts for all using (auth.uid() = user_id);