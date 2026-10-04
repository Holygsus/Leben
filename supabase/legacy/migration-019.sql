-- Leben OS — Migration 019
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Aufwandsklassen-geführter Tagesplan-Durchgang (siehe
-- wissensdatenbank/features/tagesplan-algorithmus-v2.md, "Entschiedenes Zielbild (V2)", War Room
-- 2026-07-21) — Bereichs-Rotation innerhalb einer Aufwandsklasse braucht einen Recency-Zeitstempel
-- pro Bereich. null = "nie bedient", sortiert automatisch zuerst.

alter table areas add column if not exists last_served_at timestamptz;
