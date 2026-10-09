# Stammbaum: Stämme, Äste, Abzweigungen

Aufgaben im Leben OS wachsen wie ein Stammbaum: Am Anfang steht eine Sache, davon gehen Äste ab.
Manche Äste enden, manche verzweigen sich weiter, und manche lösen sich und werden ein komplett
neuer Stamm mit eigenen Ästen. Alle Bausteine des Pulse halten sich an dieses Modell.

Zwei Verbindungen tragen das:
- `parent_task_id` = **Struktur**: was gehört innerhalb eines Stamms zusammen (Stamm › Ast › Zweig).
- `followup_source_id` = **Herkunft**: aus welchem Schritt etwas entstanden ist, auch über
  Stammgrenzen hinweg. So bleibt der Stammbaum lesbar, wenn ein Ast zum eigenen Stamm wird.

## Begriffe

- **Kopfaufgabe**: eine offene Aufgabe, die ein Thema trägt (Titel = Thema, z. B. „Warhammer“).
  Sie wird nicht „erledigt“ wie ein Schritt, sondern ist der Container für alles darunter.
- **Schritt**: eine kleine, abhakbare Aufgabe unter einer Kopfaufgabe (5–30 min, Boss-Level 60).
- **Vertiefung**: Aus einem Unterthema wird eine eigene Kopfaufgabe *unter* der bisherigen (ein
  Ast, der sich weiter verzweigt).
- **Abzweigung**: Ein Unterthema löst sich und wird ein **neuer Stamm**, oft in einem anderen
  Bereich, mit Herkunftsverweis auf den Schritt, aus dem er kam.
- **Ast endet**: Ein Schritt bekommt keine Folgevorschläge (`closed`). Hat eine Kopfaufgabe keine
  offenen Schritte mehr und der Pulse sieht keine sinnvolle Fortsetzung, schlägt er einen letzten
  Schritt mit `frame = 'Abschluss'` vor (z. B. „Völker: Fazit in 3 Sätzen notieren“). Danach ist
  der Ast fertig.

## Beispiel: Warhammer

```
Warhammer                         ← Kopfaufgabe (aus MSGA-Erstaufgabe)
├─ Überblicksvideo schauen  ✓
├─ Die großen Fraktionen auflisten  ✓
├─ Völker                          ← Vertiefung: neue Kopfaufgabe
│  ├─ Imperium: Wiki-Seite lesen  ✓
│  ├─ Orks: 10-min-Lore-Video  ✓
│  └─ Space Marines                ← nächste Vertiefung
│     ├─ Die ersten 3 Orden nachlesen
│     └─ Horus Heresy: Zusammenfassung lesen
└─ Tabletop: Starterbox-Preise checken  ✓
        ⤷ Abzweigung: neuer Stamm „Miniaturen bemalen“ (Bereich Kreativ),
          Herkunft = dieser Schritt
```

## Die Treppe: wie ein Stamm aufgebaut wird

Jeder neue Stamm und jede Vertiefung beginnt unten. Stufen werden nicht übersprungen, die Schritte
jeder Stufe sind 5–10 min (Kontext/Zugang) bzw. bis 30 min (danach):

| Stufe | Zweck | Beispiel Musik | Beispiel Warhammer |
|---|---|---|---|
| 1 Kontext | verstehen, wo der User steht und was ihn reizt | „Welche 3 Artists/Tracks hörst du gerade am meisten?“ | „Was hat dich an Warhammer neugierig gemacht? Ein Satz“ |
| 2 Zugang | Werkzeug, Quelle oder Einstieg besorgen | „BandLab aufs Handy laden“ | „Ein 10-min-Einsteigervideo raussuchen“ |
| 3 Erster Kontakt | einmal anfassen, ohne Anspruch | „5 min im Beat-Maker rumklicken“ | „Das Video schauen“ |
| 4 Richtung | aus Kontext und Kontakt eine Richtung ableiten | „Was willst du: Beats bauen, mixen oder Musik besser verstehen?“ | „Was reizt mehr: Lore, Spiele oder Tabletop?“ |
| 5 Ziel | strukturiert auf das Ziel zuarbeiten | „Einen 8-Takte-Loop bauen“ … später „Set mit 3 Tracks“ | Vertiefung Völker … |

- Welche Stufe erreicht ist, liest der Pulse aus den erledigten Schritten und den Notizen des
  Stamms. Antworten aus Stufe 1 und 4 (stehen in den Notizen) sind die Grundlage für alles danach.
- Folgevorschläge bleiben auf der aktuellen Stufe oder gehen genau eine weiter.
- Boss-Level frühestens ab Stufe 4, und auch dann nur einen spürbaren Schritt größer, kein Sprung
  ans Ziel.
- Der Stamm-Titel ist der Wunsch bzw. das Ziel („Musik machen und mixen“), die Treppe der Weg
  dorthin.

## Wo landet ein Vorschlag? (`placement`)

| placement | Bedeutung | Wird angelegt |
|---|---|---|
| `sibling` (Standard) | normaler Folgeschritt | neuer Schritt unter **derselben Kopfaufgabe** wie der erledigte Schritt |
| `deepen` | Vertiefung (`frame = 'Vertiefung'`) | neue Kopfaufgabe `topic_title` unter der Kopfaufgabe des erledigten Schritts **plus** erster Schritt `title` darin |
| `new_root` | neuer Stamm: MSGA-Erstaufgabe **oder** Abzweigung (`frame = 'Abzweigung'`) | neue Top-Level-Kopfaufgabe `topic_title` im Bereich `area_id` **plus** erster Schritt `title` darin; bei Abzweigung mit `followup_source_id` = erledigter Schritt |

Bei `sibling` und `deepen` erbt die neue Aufgabe immer den **Bereich der Kopfaufgabe** (die App
ignoriert dort `area_id`, sonst wäre sie in der Übersicht unsichtbar). Ein anderer Bereich geht
nur über `new_root`, also als Abzweigung.

Boss-Level ist immer `sibling`. Die Kopfaufgabe des erledigten Schritts ist sein
`parent_task_id`. Hat der Schritt keine Mutter (Altbestand), wird er selbst zur Kopfaufgabe.

## Wann Vertiefung?

Eine Vertiefung wird vorgeschlagen (höchstens eine pro Kopfaufgabe und Lauf), wenn unter einer
Kopfaufgabe:
- **≥ 3 erledigte Schritte** um dasselbe Unterthema kreisen (z. B. drei Schritte zu Völkern), oder
- ein Schritt zu einem klar abgrenzbaren Unterthema mit **4–5** bewertet wurde und die
  Feedback-Notiz Lust auf mehr zeigt.

Nicht vertiefen, wenn es das Unterthema schon als Kopfaufgabe gibt (dann `sibling`-Schritte dort
hinein vorschlagen) oder wenn eine Vertiefung im selben Baum zuletzt verworfen wurde und es kaum
neue Schritte dazu gibt.

Eine Vertiefung ist selbst ein kleiner Schritt: Die neue Kopfaufgabe startet wieder auf Stufe 1
(Kontext) der Treppe, 5–10 min. Die Tiefe entsteht über die Zeit, nicht durch einen großen Brocken.

## Wann Abzweigung statt Vertiefung?

Vertiefung, wenn das Unterthema **im Thema bleibt** (Space Marines bleiben Warhammer). Abzweigung,
wenn es ein **eigenständiges Thema** wird, das auch ohne den alten Stamm Sinn ergibt, oft in einem
anderen Bereich (Miniaturen bemalen ist ein Kreativ-Hobby, nicht mehr Warhammer-Lore). Im Zweifel
Vertiefung: Ein Ast lässt sich später noch lösen, ein zu früh gelöster Stamm verwaist leicht.

## Kontext für Vorschläge

Für einen erledigten Schritt immer den Pfad nach oben lesen (Kopfaufgabe, deren Kopfaufgabe, …)
und die Geschwister auf der eigenen Ebene. So bleiben Vorschläge auf der richtigen Ebene: Wer
gerade bei Space Marines ist, bekommt Space-Marines-Schritte, nicht wieder „Warhammer-Überblick“.
