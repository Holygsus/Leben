# Funken und Brücke ins Leben OS

## Inhalt
1. Statusfluss
2. Funken finden
3. Funken anlegen
4. Bewertung und Lernen
5. Brücke: Task anlegen
6. Rückweg: Erledigtes spiegeln
7. Termine aus dem Gespräch → Übergabe an den Pulse

## 1. Statusfluss

`neu` → (vorgeschlagen) `besprochen` → `angenommen` → `im_lifeos` → `umgesetzt`
oder jederzeit → `verworfen`.

- Funke wird im Gespräch gepitcht → `besprochen`.
- „spannend“ → `rating = 1`. Wenn er direkt loslegen will → angenommen → Brücke → `im_lifeos`.
- „spannend, aber nicht jetzt“ → `rating = 1`, bleibt `besprochen`.
- „nicht für mich“ → `rating = -1`, `status = 'verworfen'`, `decided_at = now()`, Begründung in `feedback`, falls er eine nennt.
- Task im Leben OS erledigt → `umgesetzt`.

## 2. Funken finden

Was ein guter Funke ist: konkret, klein startbar, und er sagt dem User etwas, das er selbst so noch nicht verbunden hat. Arten (`kind`): hobby, app, investment, weiterbildung, lifeos_verbesserung, verknuepfung, sonstiges.

Hilfsabfragen (Palast-Projekt):

Wiederholung — Orte mit vielen Einträgen in kurzer Zeit, aber ohne Fortschritt im next_step:
```sql
select p.id, p.name, count(e.*) n, max(e.occurred_at) zuletzt
from places p join entries e on e.place_id = p.id
where e.occurred_at > now() - interval '30 days'
group by p.id, p.name having count(*) >= 3 order by n desc;
```

Schlummer — `select * from dormant_places where zuletzt_beruehrt < now() - interval '21 days';`

Kombination — Orte in verschiedenen Räumen mit inhaltlicher Nähe, die noch keine Tür haben. Inhaltlich beurteilen; Türen mit `kombinierbar` sind gute Startpunkte.

Lücke — wiederkehrende `open_questions` oder `frage`-Einträge, die seit Wochen unbeantwortet sind.

Bereits verworfene Funken prüfen, bevor du etwas Ähnliches vorschlägst:
```sql
select s.title, s.kind, s.signal, s.feedback, s.decided_at,
  (select count(*) from entries e join spark_evidence se on se.place_id = e.place_id
   where se.spark_id = s.id and e.occurred_at > s.decided_at) neue_belege
from sparks s where s.status = 'verworfen';
```
Ähnlicher verworfener Funke + kaum neue Belege → nicht vorschlagen.

## 3. Funken anlegen

```sql
with s as (
  insert into sparks (title, kind, signal, pitch, reasoning, priority, starter_task, status)
  values ($t$Titel$t$, 'hobby', 'kombination', $t$Pitch 1–2 Sätze$t$,
          $t$Warum: welche Belege, welches Muster$t$, 1, $t$kleinste Startaufgabe$t$, 'besprochen')
  returning id
)
insert into spark_evidence (spark_id, place_id, entry_id)
select s.id, x.place_id, x.entry_id from s,
  (values ('<place_a>'::uuid, null::uuid), (null, '<entry_b>'::uuid)) x(place_id, entry_id);
```
Erst anlegen, wenn du ihn auch wirklich pitchst. `priority` 1 = stärkster.

## 4. Bewertung und Lernen

```sql
update sparks set rating = -1, status = 'verworfen', decided_at = now(), feedback = $t$...$t$
where id = '<id>';
```

Vor dem Vorschlagen kurz die Trefferquote prüfen:
```sql
select kind, signal, count(*) n,
  sum((rating = 1)::int) spannend, sum((rating = -1)::int) nicht_fuer_mich
from sparks where rating is not null group by kind, signal order by n desc;
```
Arten/Signale mit klar negativer Bilanz seltener und nur mit starken Belegen vorschlagen; zündende bevorzugen. Bei sehr wenig Daten (< ~5 Bewertungen) noch nichts daraus ableiten.

## 5. Brücke: Task anlegen

Leben-OS-Projekt: `eimyiymmqciiyxaqluzc`. `tasks.user_id` ist Pflicht. Der User ist `715a6a5a-7739-4b1a-b34d-508ac39d6dc2` (der einzige mit Tasks). In `areas` liegen auch Bereiche anderer Accounts — nur seine verwenden:
```sql
select id, name from areas where user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2' order by sort_order;
```
Passenden Bereich inhaltlich wählen (z.B. Musik, Medien, Weiterbildung, Leben OS, Gesundheit, Freizeit).

```sql
insert into tasks (user_id, area_id, title, effort, status)
values ('715a6a5a-7739-4b1a-b34d-508ac39d6dc2', '<area_id>', $t$Startaufgabe$t$, 10, 'open')
returning id, title;
```
`effort` nur 5, 10, 30 oder 60. Startaufgaben meist 5–30.

Dann im Palast:
```sql
update sparks set status = 'im_lifeos', lifeos_task_id = '<task_id>', decided_at = coalesce(decided_at, now())
where id = '<spark_id>';
insert into anchors (place_id, system, ref_table, ref_id, label)
values ('<schublade_id>', 'lifeos', 'tasks', '<task_id>', $t$Startaufgabe$t$);
```
Dem User nur sagen: „Steht im Leben OS unter <Bereich>: <Titel> (10 min).“

## 6. Rückweg: Erledigtes spiegeln

Beim Besuch einer Schublade mit Leben-OS-Ankern bzw. im Rundgang:

1. Anker sammeln (Palast): `select place_id, ref_id from anchors where system = 'lifeos' and ref_table = 'tasks';`
2. Status und Feedback holen (Leben OS):
```sql
select t.id, t.title, t.status, t.updated_at, f.id fb_id, f.rating, f.note, f.created_at
from tasks t left join task_feedback f on f.task_id = t.id
where t.id in ('<id1>', '<id2>');
```
`task_feedback.rating` ist 1–5.
3. Duplikatschutz: gespiegelte Einträge tragen in `url` den Schlüssel `lifeos://task/<task_id>` bzw. `lifeos://task_feedback/<fb_id>`. Vorher prüfen:
```sql
select url from entries where url like 'lifeos://%';
```
4. Neu Erledigtes/Bewertetes als Eintrag in die Schublade:
```sql
insert into entries (place_id, kind, body, url, source)
values ('<schublade_id>', 'feedback', $t$Erledigt: <Titel>. Bewertung 4/5: <Notiz>$t$,
        'lifeos://task_feedback/<fb_id>', 'lifeos');
```
5. Funke mit dieser `lifeos_task_id` auf `umgesetzt` setzen, wenn der Task `done` ist. Lagebericht und `next_step` der Schublade nachziehen — oft ist der nächste Schritt jetzt die zweite, etwas größere Aufgabe.

## 7. Termine aus dem Gespräch → Übergabe an den Pulse

Der Palast legt keine Events an. Er hinterlegt den Termin so, dass der Pulse ihn findet:
```sql
insert into entries (place_id, kind, body, url, source)
values ('<schublade_id oder null>', 'entscheidung',
        $t$Termin 11.10.2026, 20 Uhr: Kino mit Lynn$t$, 'termin://2026-10-11', 'chat')
returning id;
```
`url = 'termin://<datum>'` ist das Erkennungszeichen. Hat der Pulse das Event angelegt, setzt er
`url` auf `lifeos://task/<event_id>`. Kein Semikolon im Text (siehe `sql.md`).
