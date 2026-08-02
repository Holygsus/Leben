-- Leben OS — Migration 028
-- Folgeaufgaben-Vorschläge: Status 'muted' für stumm vorbefüllte, noch offene Aufgaben
-- (wissensdatenbank/features/folgeaufgaben-vorschlaege.md, Nutzer-Erweiterung 2026-07-30).
--
-- Der Skill reichert nicht nur abgeschlossene, sondern auch noch offene Aufgaben schon mit
-- Vorschlägen an (status 'muted' = unsichtbar). completeTaskCascade (js/tasks.js) schaltet sie beim
-- Abschluss automatisch auf 'open', reopenTaskCascade zurück auf 'muted'. Damit erscheinen
-- Vorschläge im "fertig"-Moment sofort statt erst nach dem nächsten manuellen Skill-Lauf.

alter table task_followup_suggestions drop constraint if exists task_followup_suggestions_status_check;
alter table task_followup_suggestions add constraint task_followup_suggestions_status_check
  check (status in ('open', 'muted', 'accepted', 'dismissed'));
