-- Sendeschema: feste Slots pro Wochentag (1=Mo … 7=So)
create table public.broadcast_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  slot_name text not null,
  slot_kind text not null check (slot_kind in
    ('stamm','film','doku','schnupper','premiere','live','vorschau','wiederholung','frei')),
  theme_types text[] not null default '{}',   -- z.B. {doku}, {serie,anime}
  theme_genres text[] not null default '{}',
  max_minutes integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, weekday, start_time)
);

-- Termine: Sport, Live-Events, Premieren, Releases, Trailer
create table public.watch_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  kind text not null check (kind in ('sport','live','premiere','release','trailer')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  watchlist_item_id uuid references public.watchlist_items(id) on delete set null,
  competition text,                 -- Liga/Turnier
  url text,                         -- Trailer- oder Stream-Link
  priority smallint not null default 0,
  source text not null default 'manuell' check (source in ('manuell','tmdb','kalender','claude')),
  external_ref text,
  created_at timestamptz not null default now()
);
create index watch_events_user_time_idx on public.watch_events (user_id, starts_at);
create unique index watch_events_ext_uidx on public.watch_events (user_id, source, external_ref)
  where external_ref is not null;

-- Konkretes Programm (Ausstrahlungsplan)
create table public.broadcast_program (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  air_date date not null,
  start_time time not null,
  slot_id uuid references public.broadcast_slots(id) on delete set null,
  slot_kind text not null,
  watchlist_item_id uuid references public.watchlist_items(id) on delete cascade,
  event_id uuid references public.watch_events(id) on delete cascade,
  reason text,
  status text not null default 'geplant' check (status in ('geplant','gesehen','uebersprungen','verdraengt')),
  created_at timestamptz not null default now(),
  check (watchlist_item_id is not null or event_id is not null)
);
create index broadcast_program_user_date_idx on public.broadcast_program (user_id, air_date);

alter table public.watchlist_viewing_log
  add constraint watchlist_viewing_log_program_fk
  foreign key (program_entry_id) references public.broadcast_program(id) on delete set null;

-- Interessenprofil
create table public.watch_interest_profile (
  user_id uuid not null default auth.uid(),
  dimension text not null check (dimension in ('genre','tag','mood','type','person')),
  value text not null,
  weight numeric not null default 0,
  signals integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, dimension, value)
);

-- RLS wie im restlichen Life OS
alter table public.broadcast_slots enable row level security;
alter table public.watch_events enable row level security;
alter table public.broadcast_program enable row level security;
alter table public.watch_interest_profile enable row level security;
create policy "broadcast_slots: own data" on public.broadcast_slots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watch_events: own data" on public.watch_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "broadcast_program: own data" on public.broadcast_program for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watch_interest_profile: own data" on public.watch_interest_profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
