alter table task_followup_suggestions drop constraint if exists task_followup_suggestions_status_check;
alter table task_followup_suggestions add constraint task_followup_suggestions_status_check
  check (status in ('open', 'muted', 'accepted', 'dismissed'));