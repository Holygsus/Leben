-- Wishlist: Shop-Felder
alter table public.wishlist_items
  add column shop_since timestamptz,
  add column bought_at timestamptz,
  add column bought_price numeric,
  add column note text;

-- Abkuehlzeit startet automatisch, sobald ein Item in den Shop kommt
create or replace function public.wishlist_shop_since() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('active','ready') and new.shop_since is null then
    new.shop_since := now();
  end if;
  if new.status = 'bought' and new.bought_at is null then
    new.bought_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger wishlist_shop_since before insert or update on public.wishlist_items
  for each row execute function public.wishlist_shop_since();

-- Runs: ein Run = ein Monat
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  run_month date not null,
  surplus numeric not null default 0,
  note text,
  closed_at timestamptz default now(),
  unique (user_id, run_month)
);
alter table public.runs enable row level security;
create policy "runs: own data" on public.runs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Muenzbuch: der eine gemeinsame Stapel
create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  amount numeric not null,
  kind text not null check (kind in ('run_end','purchase','correction','bonus')),
  run_id uuid references public.runs(id) on delete set null,
  wishlist_item_id uuid references public.wishlist_items(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  note text,
  created_at timestamptz default now()
);
create index coin_ledger_user_idx on public.coin_ledger(user_id);
alter table public.coin_ledger enable row level security;
create policy "coin_ledger: own data" on public.coin_ledger for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Kontostand des Stapels
create view public.coin_balance with (security_invoker = true) as
select user_id, sum(amount) as balance,
       sum(amount) filter (where kind = 'run_end') as earned_total,
       -sum(amount) filter (where kind = 'purchase') as spent_total,
       count(distinct run_id) as runs
from public.coin_ledger group by user_id;

-- Der Shop: Wishlist + Reisen, Status wird berechnet
create view public.shop with (security_invoker = true) as
with bal as (select user_id, balance from public.coin_balance),
items as (
  select w.user_id, w.id, 'wish'::text as source, w.title, w.category, w.priority,
         w.current_price as price, w.shop_since, w.status as raw_status, w.product_url as url
  from public.wishlist_items w
  union all
  select t.user_id, t.id, 'trip', coalesce(t.title, t.destination), 'enjoy', t.priority,
         t.budget_target, t.created_at, t.status, null
  from public.trips t
  where t.status in ('traum','geplant') and t.budget_target is not null
)
select i.*,
  case when i.price is null then null
       when i.price < 100 then 'klein'
       when i.price < 500 then 'mittel'
       else 'gross' end as tier,
  coalesce(b.balance, 0) as coins,
  case when i.price > 0 then least(100, round(coalesce(b.balance,0) / i.price * 100)) end as progress_pct,
  greatest(0, 14 - (current_date - i.shop_since::date)) as cooldown_days_left,
  case
    when i.raw_status in ('bought') then 'gekauft'
    when i.source = 'wish' and i.raw_status = 'inactive' then 'idee'
    when i.price is null then 'idee'
    when i.shop_since is not null and current_date - i.shop_since::date < 14 then 'abkuehlen'
    when coalesce(b.balance,0) >= i.price then 'leistbar'
    else 'sparen'
  end as shop_state
from items i left join bal b on b.user_id = i.user_id;