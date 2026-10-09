# Baustein: Palast-Pflege

Hält den Gedächtnispalast mit dem Leben OS synchron und lässt ihn nach seinen Wachstumsregeln
weiterwachsen. Alle Regeln (Hierarchie, Wachstum, Lagebericht, Prüfer) kommen aus dem Skill
`gedaechtnispalast`. Hier nur der tägliche Ausschnitt.

Subagent: nur lesen und berichten. Der Pulse schreibt.

## 0. Jeder Stamm hat eine Schublade

Jeder Stamm im Leben OS (Top-Level-Kopfaufgabe) ist mit genau einer Palast-Schublade verbunden
(Anker `system = 'lifeos'`, `ref_table = 'tasks'`, `ref_id` = Stamm-ID, `label` = Stamm-Titel).
- Stamm ohne Anker → per `palace_lookup` die passende Schublade suchen und Anker setzen. Keine
  passende Schublade → nach den Wachstumsregeln anlegen (im passenden Raum). Raum unklar → im
  Bericht als `umbau`-Vorschlag, bis dahin kein Anker.
- Vertiefungen (Kopfaufgaben unter einem Stamm) erben den Anker des Stamms. Bekommt ein Unterthema
  genug Einträge für eine eigene Schublade, wird es nach den Wachstumsregeln vertieft und die
  Kopfaufgabe bekommt einen eigenen Anker.
- Abzweigungen (neuer Stamm) bekommen einen eigenen Anker und eine Tür (`baut_auf`) zur Schublade
  des Ursprungs-Stamms.

So findet jede erledigte Aufgabe ihren Ort über den Anker ihres Stamms, ohne Raten.

## 1. Rückspiegelung (Hauptaufgabe)

Ablauf und Duplikatschutz genau wie `gedaechtnispalast/references/funken.md` Abschnitt 6:
- Leben-OS-Anker im Palast sammeln, Status und `task_feedback` holen.
- Neu Erledigtes/Bewertetes → `feedback`-Eintrag (`source = 'lifeos'`,
  `url = 'lifeos://task_feedback/<id>'` bzw. `lifeos://task/<id>`) in die verankerte Schublade.
- Funke mit erledigter `lifeos_task_id` → `umgesetzt`.

Gespiegelt wird jeder erledigte Schritt **mit Notiz**, die mehr ist als eine Erledigungsbestätigung
(„Erledigt“, „Wurde hinzugefügt“ entfallen). Momentaufnahmen (Termine, Daten, „heute X gemacht“)
werden nicht als eigener Eintrag gespiegelt (Termine werden stattdessen Events im Leben OS, siehe
`folgeaufgaben.md` Abschnitt 5), sondern höchstens als bleibende Aussage formuliert
(„Padel macht Spaß, 4/5“ statt „nächster Termin Samstag 18:30“). Ort = Schublade des Anker-Stamms. Die Art passt sich an
den Inhalt an: Frage → `frage`, Vorliebe/Rahmen → `erkenntnis`, Erlebnis → `erfahrung`, Idee →
`idee`. Bewertung nur nennen, wenn sie nicht 3 ist.

## 1b. Notizen auswerten

Feedback-Notizen enthalten oft mehr als das Ergebnis:
- **Leben-OS-Feedback** (z. B. „der Zähler muss in die Heute-Ansicht“) → Eintrag `feedback` in
  *Werkstatt › System-Feedback* bzw. die passende Tab-Schublade.
- **Namen** (z. B. „Lynn gefragt, ob wir It Takes Two weiterspielen“) → im Raum *Salon* (🛋️) eine
  Schublade pro Person (anlegen, wenn es sie nicht gibt) mit einem Eintrag: was die Person dem User
  bringt bzw. womit sie verbunden ist (gemeinsame Interessen, Können, Anlässe). Der Lagebericht der
  Personen-Schublade fasst das in 2–3 Sätzen zusammen. Türen zu den Themen-Schubladen setzen
  (`verwandt`). Nur Fakten aus den Notizen, keine Wertungen über die Person.
- **Rahmenbedingungen** (kein Laptop, Budget, fehlender Abschluss) → Eintrag `erkenntnis` in die
  Themen-Schublade, damit Leitplanke 6 greift.

## 2. Lageberichte nachziehen

Für jede Schublade, die heute einen Spiegel-Eintrag bekommt: `briefing`, `open_questions`,
`next_step` aktualisieren (Regeln aus `gedaechtnispalast` Abschnitt 4). Oft ist der nächste
Schritt jetzt die zweite, etwas größere Aufgabe.

## 3. Wachstum

Nach den Wachstumsregeln (`gedaechtnispalast` Abschnitt 3) prüfen und im Bericht als `umbau`
melden:
- neue Schublade (≥ 2 Einträge zu eigenständigem Thema, z. B. in der Inbox),
- neuer Schrank (≥ 3 Schubladen mit gemeinsamem Dach oder eine Schublade ab ca. 8–10 Einträgen),
- Vertiefen (Einträge zielen auf verschiedene nächste Schritte),
- fehlende **Türen** zwischen Orten, die inhaltlich zusammengehören (wichtig für Funken und MSGA).

Schubladen, Schränke, Vertiefungen und Türen setzt der Pulse nach seiner Frischeprüfung selbst um.
Neue Räume, Umbenennen, Zusammenlegen, Archivieren kommen nur als Vorschlag in die Rückmeldung.

Die Inbox wird hier **nicht** sortiert, das macht der Rundgang im Weekly. Nur wenn ein Inbox-Thema
die Schwelle für eine neue Schublade reißt, wird es gemeldet.

## 4. Prüfer

Hat der Pulse Einträge oder Orte angelegt oder bewegt, schreibt er die Übergabe und startet den
Prüfer genau wie in `gedaechtnispalast` Abschnitt 8.
