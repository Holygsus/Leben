-- Leben OS — Migration 010
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Watchlist-Bewertung von Daumen hoch/runter auf 1-10 umgestellt (siehe
-- wissensdatenbank/features/watchlist-fernsehprogramm.md, Abschnitt "Bewertung").

alter table watchlist_viewing_log drop constraint if exists watchlist_viewing_log_rating_check;

-- Bestehende 'up'/'down'-Einträge einmalig auf die neue Skala übertragen (grobe, aber
-- deterministische Rückwärtskonvertierung; bei Bedarf im Nachgang manuell im Sichtungs-Log
-- korrigierbar, betrifft nur die bisher schon geloggten Sichtungen).
alter table watchlist_viewing_log alter column rating type integer using (
  case rating::text when 'up' then 10 when 'down' then 3 else null end
);

alter table watchlist_viewing_log add constraint watchlist_viewing_log_rating_check
  check (rating between 1 and 10);
