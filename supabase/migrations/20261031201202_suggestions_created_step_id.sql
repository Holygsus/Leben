-- Bauplan 8309c961 Teil C1: Bei deepen/new_root zeigt created_task_id auf die Kopfaufgabe (Mutter).
-- created_step_id hält zusätzlich den angelegten Schritt (Kind), damit der Daily Kinder nicht mehr
-- über den Titel zuordnen muss. Bei sibling sind beide gleich.
alter table public.task_followup_suggestions
  add column if not exists created_step_id uuid references public.tasks(id) on delete set null;

comment on column public.task_followup_suggestions.created_step_id is
  'Setzt die App beim Übernehmen: ID des angelegten Schritts (Kind). Bei sibling gleich created_task_id.';
