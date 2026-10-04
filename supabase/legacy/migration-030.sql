-- Leben OS — Migration 030
-- Ausgaben-Kategorien: optionales Monatsbudget pro Kategorie (QoL, 2026-08-02).
--
-- Erlaubt eine Ampel im Kategorien-Tab (grün/gelb/rot je nach Anteil der Monatsausgaben am Budget).
-- Nullable — ohne gesetztes Budget bleibt die Kategorie ampellos wie bisher.

alter table expense_categories add column if not exists monthly_budget numeric;
