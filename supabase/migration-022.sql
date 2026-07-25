-- Leben OS — Migration 022
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
-- Update 2026-07-25: via Supabase-MCP angewendet, live in der Produktions-DB verifiziert —
-- nicht erneut ausführen.
--
-- Staffel-Struktur für Watchlist-Einträge (siehe wissensdatenbank/features/watchlist-fernsehprogramm.md,
-- "Automatische Metadaten-Anreicherung"). Zwei leichte Felder, damit die Fortschrittsanzeige
-- "Staffel S · Folge E von Y" möglich wird. Befüllung manuell im Detail-Modal; die automatische
-- TMDB-Anreicherung läuft später über das Weekly, nicht hier.

alter table watchlist_items add column if not exists season_count integer;
alter table watchlist_items add column if not exists episode_counts_by_season jsonb;
