-- Themenbaum/Stammbaum: Folgevorschläge mit Platzierung (sibling = Schritt, deepen = Vertiefung,
-- new_root = Abzweigung zu einem neuen Stamm) und Erstaufgaben (immer new_root, ohne
-- Ursprungsaufgabe). Pulse schreibt diese Felder, die App übernimmt danach.
alter table task_followup_suggestions alter column source_task_id drop not null;

alter table task_followup_suggestions
  add column if not exists kind text not null default 'folge',
  add column if not exists placement text not null default 'sibling',
  add column if not exists topic_title text,
  add column if not exists reason text,
  -- Reine Referenzen in ein anderes Supabase-Projekt (Gedächtnispalast), bewusst ohne FK.
  add column if not exists palace_place_id uuid,
  add column if not exists spark_id uuid,
  add column if not exists created_task_id uuid references tasks(id) on delete set null;

alter table task_followup_suggestions
  add constraint task_followup_suggestions_kind_check
    check (kind in ('folge', 'erstaufgabe')),
  add constraint task_followup_suggestions_placement_check
    check (placement in ('sibling', 'deepen', 'new_root')),
  add constraint task_followup_suggestions_folge_source_check
    check (kind <> 'folge' or source_task_id is not null),
  add constraint task_followup_suggestions_erstaufgabe_placement_check
    check (kind <> 'erstaufgabe' or placement = 'new_root'),
  add constraint task_followup_suggestions_topic_title_check
    check (placement not in ('deepen', 'new_root') or topic_title is not null);

create index if not exists task_followup_suggestions_user_kind_status_idx
  on task_followup_suggestions (user_id, kind, status);
