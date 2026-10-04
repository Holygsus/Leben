alter table transactions
  add constraint transactions_category_check
  check (category is null or category in ('essen', 'wohnen', 'transport', 'freizeit', 'gesundheit', 'sonstiges'));