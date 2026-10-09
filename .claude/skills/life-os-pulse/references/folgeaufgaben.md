# Baustein: Folgeaufgaben

Erledigte Aufgaben bekommen passende nächste Schritte vorgeschlagen. Der User wählt im
„Neue Vorschläge“-Popup des Leben OS aus. Die App übernimmt, nestet unter die Mutter und schließt
die Ursprungsaufgabe. Dieser Baustein liefert **nur Vorschläge**, er legt nie selbst Aufgaben an.

Subagent: nur lesen und berichten (Abschnitte 1–3). Der Pulse schreibt (Abschnitt 4).

## Datenmodell

| Tabelle | Feld | Bedeutung |
|---|---|---|
| `tasks` | `followup_status` | `null` normal · `pending` erledigt, wartet auf Pulse · `suggested` hat offene Vorschläge · `closed` nie wieder |
| `tasks` | `followup_source_id` | Folgeaufgaben-Kette |
| `tasks` | `parent_task_id` | Mutter-/Unteraufgaben-Baum |
| `task_followup_suggestions` | `status` | `open` im Popup · `muted` vorbereitet für noch offene Aufgabe · `accepted` / `dismissed` vom User |
| `task_followup_suggestions` | `frame` | Rahmen-Label vor dem Titel im Popup |
| `task_followup_suggestions` | `effort` | nur 5 / 10 / 30 / 60 |
| `followup_topic_tally` | `topic`, `offered_count` | Themen-Dämpfer: angeboten und nie gewählt |
| `task_feedback` | `rating` 1–5, `note` | Bewertung beim Abschluss, steuert Boss-Level |
| `task_comments` | `body` | Notizen zur Aufgabe |

Was die App selbst tut: Abhaken setzt die abgehakte Wurzel auf `pending` (Habits ausgenommen).
Gibt es `muted`-Vorschläge, schaltet sie diese auf `open` und setzt `suggested`. Wiederöffnen setzt
zurück. Bestätigen im Popup: angehakte werden zu Aufgaben unter der Mutter, der Rest wird
`dismissed`, die Ursprungsaufgabe wird `closed`.

## 1. Kandidaten

**Erledigte Aufgaben** (Hauptfall, holt auch Liegengebliebenes nach Pausen nach):
```sql
select t.id, t.title, t.area_id, a.name area, t.parent_task_id, t.followup_source_id,
       t.effort, t.updated_at
from tasks t left join areas a on a.id = t.area_id
where t.user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2'
  and t.status = 'done'
  and t.followup_status = 'pending'
  and t.habit_weekdays is null
  and t.watchlist_item_id is null
  and not exists (select 1 from task_followup_suggestions s where s.source_task_id = t.id)
order by t.updated_at desc
limit 15;
```

**Optional – stumme Vorbereitung** für heute/morgen geplante, noch offene Aufgaben, damit das Popup
im Abschluss-Moment sofort kommt:
```sql
select t.id, t.title, t.area_id, a.name area, t.parent_task_id, t.followup_source_id, t.effort
from tasks t left join areas a on a.id = t.area_id
where t.user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2'
  and t.status in ('open', 'planned')
  and t.planned_date between current_date and current_date + 1
  and t.followup_status is null
  and t.habit_weekdays is null
  and t.watchlist_item_id is null
  and coalesce(t.is_event, false) = false
  and not exists (select 1 from task_followup_suggestions s where s.source_task_id = t.id)
limit 10;
```

**Ignorieren-Regel:** Hat eine Aufgabe schon *irgendwelche* Vorschläge oder ist sie
`suggested`/`closed`, wird sie stumpf ignoriert. Keine Nachbesserung, kein Ergänzen.

## 2. Kontext pro Kandidat

```sql
select json_build_object(
  'mutter', (select row_to_json(m) from (select id, title, status, area_id from tasks where id = t.parent_task_id) m),
  'geschwister', (select json_agg(g) from (select title, status from tasks where parent_task_id = t.parent_task_id and id <> t.id) g),
  'kinder', (select json_agg(k) from (select title, status from tasks where parent_task_id = t.id) k),
  'kette', (select json_agg(c) from (select title, status from tasks where id = t.followup_source_id or followup_source_id = t.id) c),
  'feedback', (select row_to_json(f) from (select rating, note from task_feedback where task_id = t.id) f),
  'kommentare', (select json_agg(body) from task_comments where task_id = t.id),
  'abgelehnt_im_baum', (select json_agg(s.title) from task_followup_suggestions s join tasks st on st.id = s.source_task_id
                        where s.status = 'dismissed' and coalesce(st.parent_task_id, st.id) = coalesce(t.parent_task_id, t.id)),
  'boss_im_baum', (select json_agg(json_build_object('titel', s.title, 'status', s.status)) from task_followup_suggestions s
                   join tasks st on st.id = s.source_task_id
                   where s.frame = 'Boss-Level' and coalesce(st.parent_task_id, st.id) = coalesce(t.parent_task_id, t.id))
) from tasks t where t.id = '<task_id>';
```

Lesen:
- **Mutter + Geschwister**: übergeordnetes Ziel. Nichts vorschlagen, was als Geschwister schon da ist.
- **Kette**: Wohin hat sich das Thema entwickelt?
- **Feedback-Notiz**: trägt oft das Ergebnis weiter („September 2026“, „zu teuer“). Darauf
  aufbauen statt es neu abzufragen. Gut gelaufen → vertiefen. Zäh → anderer, kleinerer Zugang
  oder abschließen.
- **Abgelehnte Vorschläge** und `followup_topic_tally`: Themen mit hohem `offered_count` dämpfen.

## 3. Vorschläge formulieren

### Normale Folgevorschläge: klein und breit gefächert

Pro Aufgabe **0–5**, alle auf der aktuellen Stufe der Treppe (`themenbaum.md`) oder genau eine
darüber (bewusst breite Auswahl, die Wachstumsbremse im SKILL.md verhindert das
Stapeln). Erster Vorschlag aus der Notiz-Frage, falls vorhanden. Jeder ist ein **kleiner Schritt** (effort 5, 10 oder 30, nie 60) und die
Vorschläge einer Aufgabe zeigen in **verschiedene Richtungen**, damit echte Auswahl entsteht statt
fünf Varianten desselben. Ziel ist, Stress rauszunehmen: Kein Vorschlag soll sich nach einem
Projekt anfühlen.

- `title`: konkrete Handlung im Stil seiner Aufgabentitel („X: Trailer + 2 Reviews checken“),
  keine Absicht („mehr über X lernen“).
- `frame`: 1–2 Wörter, pro Aufgabe möglichst verschieden, z. B. *Weiter*, *Vertiefen*,
  *Anwenden*, *Recherche*, *Entscheiden*, *Teilen*, *Abschluss*, *Abzweigung*.
- `area_id`: zählt nur bei `new_root` (Abzweigung). Bei `sibling`/`deepen` übernimmt die App den
  Bereich der Kopfaufgabe; trotzdem den der Mutter eintragen. Folgeaufgaben einer Unteraufgabe
  gehören, wenn sinnvoll, zur Mutteraufgabe und deren
  Bereich (die App nestet sie beim Übernehmen dort ein). Löst sich ein Unterthema zu einem
  eigenständigen Thema → Abzweigung als neuer Stamm (`placement = 'new_root'`,
  `frame = 'Abzweigung'`, `topic_title`, passender Bereich), siehe `themenbaum.md`.

### Vertiefung und Abzweigung: der Stammbaum wächst

Zusätzlich zu den normalen Vorschlägen höchstens **eine** Vertiefung pro Kopfaufgabe und Lauf,
wenn die Bedingungen aus `themenbaum.md` erfüllt sind: `frame = 'Vertiefung'`,
`placement = 'deepen'`, `topic_title` = das Unterthema (z. B. „Völker“), `title` = erster kleiner
Schritt darin. Normale Vorschläge haben `placement = 'sibling'` und landen unter der Kopfaufgabe
des erledigten Schritts. Beim Kontext immer den ganzen Pfad nach oben lesen, damit Vorschläge auf
der richtigen Ebene bleiben.

### Boss-Level: der größere Schritt als Belohnung

Hat der User die Ursprungsaufgabe mit **4 oder 5** bewertet (`task_feedback.rating`) oder zeigt die
Notiz klar Lust auf mehr (Begeisterung, Folgefrage), kommt
**zusätzlich** zu den normalen Vorschlägen genau **ein** Boss-Level:
- `frame = 'Boss-Level'`, effort meist 60 (mindestens 30).
- Ein spürbar größerer Schritt im selben Thema, der auf dem Gelungenen aufbaut. Zum Beispiel
  statt „noch ein Kapitel“ lieber „ersten eigenen Artikel dazu schreiben“, statt „Trailer
  checken“ lieber „Kaufentscheidung treffen und kaufen“.
- Kein Boss-Level ohne Bewertung 4–5 oder begeisterte Notiz. Eine 3 zählt als keine Angabe. Gab es im selben Baum schon ein offenes, nicht entschiedenes
  Boss-Level → keins stapeln.
- Wurde im Baum zuletzt ein Boss-Level `dismissed` → das nächste etwas kleiner schneiden.

### Domänen-Workflows (Palast › Leben-OS-Tabs)

- *Gaming-Wunsch*: Wunsch → Recherche → Kaufentscheidung → gekauft → ins Backlog.
- *Serien/Filme-Eyecatcher*: Wunsch → Recherche → beim Abschluss „Zur Watchlist hinzufügen?“
  (`frame = 'Entscheiden'`).

### Null ist erlaubt

In sich abgeschlossene Aufgaben (Einkauf, Termin, Routine) → keine Vorschläge, Aufgabe wird
`closed`.

## 4. Schreiben (nur Pulse)

Vorher prüfen: Aufgabe noch `pending` und ohne Vorschläge? Sonst überspringen.

```sql
insert into task_followup_suggestions (user_id, source_task_id, area_id, title, frame, effort, status)
values ('715a6a5a-7739-4b1a-b34d-508ac39d6dc2', '<task_id>', '<area_id>', $t$...$t$, $t$Weiter$t$, 10, 'open'),
       ('715a6a5a-7739-4b1a-b34d-508ac39d6dc2', '<task_id>', '<area_id>', $t$...$t$, $t$Boss-Level$t$, 60, 'open')
-- Nach dem App-Umbau zusätzlich die Spalten placement ('sibling' | 'deepen') und topic_title
-- (nur bei 'deepen'). Bis dahin Vertiefungen nur in der Pulse-Rückmeldung nennen.
returning id, left(title, 40);

update tasks set followup_status = 'suggested' where id = '<task_id>';
```
Stumme Vorbereitung: gleich, aber `status = 'muted'` und `followup_status` bleibt `null`.
Keine Vorschläge: `update tasks set followup_status = 'closed' where id = '<task_id>';`

Themen-Dämpfer (ein kurzes, klein geschriebenes Stichwort pro Vorschlag):
```sql
insert into followup_topic_tally (user_id, topic, offered_count, last_offered_at)
values ('715a6a5a-7739-4b1a-b34d-508ac39d6dc2', $t$<thema>$t$, 1, now())
on conflict (user_id, topic)
do update set offered_count = followup_topic_tally.offered_count + 1, last_offered_at = now();
```
Wurde ein Thema seit dem letzten Lauf übernommen (`accepted`), den Zähler auf 0 setzen.

## 5. Termine aus Notizen → Event

Enthält eine Feedback-Notiz (oder ein Kommentar) einen **Termin oder ein verbindliches Datum**,
wird daraus ein Event im Leben OS. Das ist keine Folgeaufgabe zur Auswahl, sondern die
Übernahme einer Verabredung, die der User selbst notiert hat. Darum wird es direkt angelegt.

Erkennen:
- Konkrete Daten („21.–26. September“, „am 14.11.“) und relative Angaben („nächste Woche
  Samstag“, „morgen 18:30“). Relative Angaben immer vom **Datum der Notiz** aus auflösen, nicht vom
  Lauf-Datum.
- Nur verbindlich Gemeintes. „Vielleicht mal im Winter“ ist kein Termin.
- Liegt das Datum schon in der Vergangenheit: kein Event.
- Nicht eindeutig auflösbar → kein Event, stattdessen eine Zeile in der Pulse-Rückmeldung
  („Padel ‚nächste Woche‘ – welcher Tag?“).

Anlegen (App-Konvention: Uhrzeit im Titel, Mehrtägiges als Zeitraum im Titel am Starttag):
```sql
insert into tasks (user_id, area_id, parent_task_id, title, status, planned_date, is_event, followup_source_id)
values ('715a6a5a-7739-4b1a-b34d-508ac39d6dc2', '<area der Kopfaufgabe>', '<Kopfaufgabe des Schritts>',
        $t$Padel spielen (18:30)$t$, 'planned', '2026-08-22', true, '<erledigter Schritt>')
returning id, title;
```
- Unter derselben Kopfaufgabe wie der Schritt, aus dessen Notiz der Termin stammt, damit er im
  Stammbaum sichtbar bleibt. `effort` bleibt leer.
- Mehrere Events am selben Tag sind normal. Doppelt angelegt wird nur nicht **derselbe** Termin:
  Der Duplikatschutz läuft über die Herkunft (dieselbe Notiz bzw. derselbe Palast-Eintrag hat
  schon ein Event), nicht über das Datum.
- Steht an dem Tag schon etwas an, legt der Pulse das Event trotzdem an und weist im
  Pulse-Briefing (SKILL.md Schritt 6) kurz darauf hin: was dort schon steht, mit Uhrzeit.
  ```sql
  select title, planned_date from tasks
  where user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2' and planned_date = '<datum>'
    and status <> 'done' order by title;
  ```
- In der Pulse-Rückmeldung nennen: „Event angelegt: Padel spielen (18:30), Sa 22.08.“
- Termine gehören nicht als eigener Eintrag in den Palast (Momentaufnahme). Höchstens eine
  bleibende Aussage dazu, z. B. „spielt regelmäßig samstags Padel“, wenn es sich wiederholt.

Die Notiz bekommt trotzdem ihre normalen Folgevorschläge. Das Event ersetzt sie nicht.

### Termine aus dem Palast

Der Palast legt selbst keine Events an, sondern hinterlegt Termine aus Gesprächen als Übergabe:
```sql
-- Palast
select e.id, e.body, substring(e.url from 'termin://(.*)')::date datum, p.id place_id, p.path::text
from entries e left join places p on p.id = e.place_id
where e.url like 'termin://%';
```
Für jeden zukünftigen Termin: Event anlegen wie oben. Platzierung: Hat die Schublade einen
Stamm-Anker, unter diesen Stamm, sonst eigenständig im passenden Bereich. Danach im Palast
`url = 'lifeos://task/<event_id>'` setzen (Duplikatschutz). Termine in der Vergangenheit ohne Event:
`url` auf `termin-verpasst://<datum>` setzen und in der Rückmeldung kurz nennen.

Hängt das Event an einem Stamm, kann es auch Folgevorschläge auslösen: Wird es nach dem Termin
abgehakt, läuft es wie jeder erledigte Schritt durch Feedback, Folgevorschläge und Boss-Level.
Eigenständige Events ohne Stamm bekommen keine Folgevorschläge, außer die Notiz zeigt ein Thema.

