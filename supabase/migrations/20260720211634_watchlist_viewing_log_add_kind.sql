alter table watchlist_viewing_log
  add column if not exists kind text not null default 'watched' check (kind in ('watched', 'skipped'));