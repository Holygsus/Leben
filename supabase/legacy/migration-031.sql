-- Leben OS — Migration 031
-- Zähl-Habits: optionales Tagesziel (QoL, 2026-08-02).
--
-- Erlaubt einen Fortschrittsbalken "heute X / Ziel" bei Zähl-Habits (z.B. 6 Gläser Wasser). Nullable
-- — ohne Ziel bleibt der Zähler offen nach oben wie bisher (nur "heute: X").

alter table tasks add column if not exists habit_daily_goal numeric;
