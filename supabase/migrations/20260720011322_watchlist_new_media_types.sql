alter table watchlist_items drop constraint if exists watchlist_items_type_check;
alter table watchlist_items
  add constraint watchlist_items_type_check
  check (type in ('serie', 'anime', 'film', 'doku', 'youtube'));