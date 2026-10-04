-- Leben OS — Migration 007
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Fügt tasks.habit_weekdays hinzu: nullable text[]. null = kein Habit; leeres Array = Habit-Flag
-- gesetzt, aber noch keine Wochentage gewählt; nicht-leeres Array = aktive Wochentags-Zuordnung
-- ('mon'..'sun'). Kein CHECK auf die Array-Elemente — Validierung passiert client-seitig in
-- js/habits.js (WEEKDAY_CODES), analog zu daily_plans.task_ids, das ebenfalls keinen Check hat.

alter table tasks add column if not exists habit_weekdays text[];
