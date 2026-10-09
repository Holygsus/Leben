# Baustein: MSGA

Das MSGA ist der Wachstums-Baustein: den User stetig weiterentwickeln, Neues ausprobieren lassen,
ihn sanft aus der Komfortzone holen, Gemeinsamkeiten seiner Interessen entdecken und gezielt
anspielen, und aus Rohgedanken im Palast **Erstaufgaben** machen. Er läuft bei jedem Pulse mit.

Subagent: nur lesen und berichten. Der Pulse schreibt.

Haltung wie im Weekly (Skill `life-os-weekly-review`, Klein-machen-Haltung und Komfortzonen-Regel):
Der User macht sich gern kleiner, als seine Historie hergibt. Aus der Komfortzone heißt aber
**nicht groß**: Auch der Wachstumsschritt ist klein (5–30 min). Der große Sprung ist nie der erste
Schritt.

## 1. Erstaufgaben aus Rohgedanken im Palast

Kandidaten, wo ein Thema existiert, aber noch nichts im Leben OS passiert:
```sql
-- Schubladen mit Inhalt, aber ohne Leben-OS-Anker und ohne next_step-Bewegung
select p.id, p.path::text, p.name, p.briefing, p.next_step, p.open_questions,
       count(e.*) eintraege, max(e.occurred_at) zuletzt
from places p
left join entries e on e.place_id = p.id
where p.kind = 'schublade' and p.status = 'aktiv'
  and not exists (select 1 from anchors a where a.place_id = p.id and a.system = 'lifeos')
group by p.id
order by count(e.*) desc, max(e.occurred_at) desc nulls last
limit 20;
```
Dazu: Einträge der Art `idee`, `frage`, `gedanke` aus den letzten Wochen sowie die Palast-Inbox
(`select * from inbox;`).

Gute Erstaufgabe (immer Stufe 1 oder 2 der Treppe aus `themenbaum.md`, 5–10 min):
- Der kleinste Schritt, der das Thema vom Gedanken in die Tat bringt (Schublade hat schon einen
  `next_step` → der ist meist die Erstaufgabe).
- **Leben OS selbst ist ein Thema wie jedes andere.** Ideen aus *Werkstatt › System-Feedback* oder
  *Leben-OS-Tabs* werden zu Erstaufgaben wie „Watchlist: Staffel-/Folgenzahl-Feld skizzieren“
  (Bereich Leben OS). Umbauten an der App sind ausdrücklich erwünscht.
- Rohgedanken, die sich zu einem Thema verdichten (≥ 2 Einträge, gleiche Richtung), haben Vorrang
  vor Einzelgedanken.

## 2. Gemeinsamkeiten in Interessen

Wo sich zwei Interessen berühren, entsteht oft der beste Wachstumsschritt, weil er auf
vorhandener Motivation aufbaut:
- Türen (`doors`) zwischen Interessen-Schubladen, besonders `kombinierbar`.
- Funken mit `signal = 'kombination'` und `rating = 1`, die noch nicht im Leben OS sind.
- Themen, die in Leben-OS-Feedback (Bewertung 4–5) **und** im Palast auftauchen.

Daraus eine Aufgabe, die beide Seiten gezielt anspielt (z. B. Musik × Gaming: „Game-Soundtrack als
Set-Übergang ausprobieren“).

## 3. Komfortzonen-Schritt

Etwas Neues oder leicht Unbequemes in einem Bereich, in dem er sich laut Daten im sicheren Bereich
bewegt: immer gleiche Art Aufgaben, Vorschläge eines Typs dauernd abgelehnt, ein Interesse seit
Wochen nur gesammelt statt ausprobiert.
- Klein, konkret, mit klarem Ende.
- Komfortzonen-Regel: Was er sich selbst vorgenommen hat, zählt mehr als die aktuelle
  Bequemlichkeit. Hat er gesagt, das Interesse ist weg → fallen lassen.
- Wird ein Komfortzonen-Schritt in der Folge mit 4–5 bewertet, greift über den Folgeaufgaben-
  Baustein automatisch das Boss-Level.

## 4. Bericht

Pro Lauf **bis zu 3 Kandidaten** für neue Mutteraufgaben, breit gefächert: aus verschiedenen
Räumen, höchstens einer davon ein Komfortzonen-Schritt. Jeweils: Titel (= die Erstaufgabe, klein,
5/10/30 min), Bereich (nur Bereiche des Users), Palast-Schublade, Belege, ein Satz „warum jetzt“.

Unabhängig von den Folgeaufgaben: Die arbeiten **in** bestehenden Aufgabenbäumen weiter (reaktiv
auf Erledigtes), das MSGA pflanzt **neue** Bäume aus dem Palast (proaktiv). Ein MSGA-Kandidat zum
Thema eines Baums, der gerade Folgevorschläge bekommt, entfällt.

Nicht vorschlagen, wenn:
- noch unentschiedene MSGA-Kandidaten im Auswahlfenster liegen (nicht stapeln, unter `verworfen`
  vermerken; das Weekly sieht es),
- ein ähnlicher Kandidat oder Funke verworfen wurde und es kaum neue Belege gibt.

## 5. Anlegen (nur Pulse)

**Zielbild: Auswahlfenster „Neue Mutteraufgaben“** im Leben OS, das direkt nach dem
Folgevorschläge-Popup erscheint. Der User hakt an, was er starten will. Angehakte Kandidaten werden
zu neuen Top-Level-Aufgaben (Mutteraufgaben), der Rest wird verworfen. Ihre spätere Erledigung
läuft dann ganz normal durch Feedback, Folgevorschläge und Boss-Level.

Eine Erstaufgabe ist im Themenbaum (`themenbaum.md`) ein `new_root`: Beim Übernehmen entsteht eine
neue Kopfaufgabe (`topic_title`, z. B. „Warhammer“) mit dem ersten kleinen Schritt (`title`) darin.

Datenmodell (Erweiterung von `task_followup_suggestions`, App-Umbau steht noch aus):
`kind = 'erstaufgabe'`, `placement = 'new_root'`, `topic_title`, `source_task_id = null`, `palace_place_id`, `spark_id`, `reason` und
`created_task_id` (setzt die App beim Übernehmen).

```sql
insert into task_followup_suggestions
  (user_id, kind, placement, topic_title, source_task_id, area_id, title, frame, effort, status, palace_place_id, spark_id, reason)
values ('715a6a5a-7739-4b1a-b34d-508ac39d6dc2', 'erstaufgabe', 'new_root', $t$Warhammer$t$, null, '<area_id>', $t$...$t$,
        $t$Neu$t$, 30, 'open', '<schublade_id>', '<spark_id oder null>', $t$warum jetzt$t$);
```
`frame`: *Neu*, *Kombination* (zwei Interessen) oder *Komfortzone*.

Vorher im Palast einen Funken anlegen (Status `neu`, mit Belegen), falls es keinen gibt.

**Rückweg** beim nächsten Pulse: Kandidaten mit `status = 'accepted'` und gesetztem
`created_task_id` → Funke `im_lifeos` + `lifeos_task_id`, Anker auf der Schublade
(`gedaechtnispalast/references/funken.md` Abschnitt 5). `dismissed` → Funke `verworfen`,
`rating = -1`.

**Bis das Auswahlfenster gebaut ist:** höchstens 1 Kandidat pro Lauf direkt als Aufgabe anlegen
(`status = 'open'`, kein `planned_date`) und sofort verankern. Die anderen Kandidaten nur in der
Pulse-Rückmeldung nennen.
