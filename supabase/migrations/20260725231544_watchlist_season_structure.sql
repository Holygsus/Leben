alter table watchlist_items add column if not exists season_count integer;
alter table watchlist_items add column if not exists episode_counts_by_season jsonb;