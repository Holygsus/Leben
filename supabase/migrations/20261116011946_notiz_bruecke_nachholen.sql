-- Notiz-Brücke (Bauplan e0086927 Schritt 1): einmaliges Nachholen.
-- Für jede offene Aufgabe, die aus einem angenommenen Vorschlag mit Link in frame oder reason
-- entstanden ist, den Vorschlagstext als Notiz (task_comments) an den angelegten Schritt hängen.
-- Ab jetzt erledigt das der Client beim Annehmen (js/followups.js, suggestionNoteBody).
-- Idempotent: eine gleichlautende Notiz an derselben Aufgabe wird nicht doppelt angelegt.
insert into public.task_comments (user_id, task_id, body)
select s.user_id, t.id, concat_ws(E'\n', nullif(btrim(s.frame), ''), nullif(btrim(s.reason), ''))
from public.task_followup_suggestions s
join public.tasks t on t.id = coalesce(s.created_step_id, s.created_task_id)
where s.status = 'accepted'
  and t.status <> 'done'
  and concat_ws(E'\n', s.frame, s.reason) ~* 'https?://'
  and not exists (
    select 1 from public.task_comments c
    where c.task_id = t.id
      and c.body = concat_ws(E'\n', nullif(btrim(s.frame), ''), nullif(btrim(s.reason), ''))
  );
