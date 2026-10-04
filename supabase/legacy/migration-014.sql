-- Neue Watchlist-Medientypen doku/youtube (wissensdatenbank/features/watchlist-fernsehprogramm.md,
-- Erweiterung "Themen-Tage & neue Medientypen", Notiz 2026-07-19) — rein additiv zum bestehenden
-- serie/anime/film-Enum, kein struktureller Unterschied.
alter table watchlist_items drop constraint if exists watchlist_items_type_check;
alter table watchlist_items
  add constraint watchlist_items_type_check
  check (type in ('serie', 'anime', 'film', 'doku', 'youtube'));
