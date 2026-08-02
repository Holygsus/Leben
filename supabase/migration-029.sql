-- Leben OS — Migration 029
-- Kühlschrank: optionales Mindesthaltbarkeitsdatum pro Zutat (QoL, 2026-08-02).
--
-- Ermöglicht die "läuft bald ab"-Warnung im Kühlschrank-Tab und füttert die Cockpit-Kachel
-- ("N laufen bald ab"). Bewusst nullable — die meisten Vorräte haben kein relevantes MHD.

alter table pantry_items add column if not exists expires_at date;
