-- Feste Kategorie-Liste für transactions.category (wissensdatenbank/finanzen-erweiterungen/
-- finanzplan-erweiterungen-v2.md, Punkt 2, War-Room-Update 2026-07-14). Spalte existiert bereits
-- ohne Constraint; category bleibt optional (null = "nicht kategorisiert").
alter table transactions
  add constraint transactions_category_check
  check (category is null or category in ('essen', 'wohnen', 'transport', 'freizeit', 'gesundheit', 'sonstiges'));
