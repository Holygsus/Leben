# Baustein: Funken

Der Pulse schaut täglich nach Funken, genau wie der Gedächtnispalast im Gespräch. Regeln, Arten,
Statusfluss und SQL stehen im Skill `gedaechtnispalast` unter `references/funken.md` und gelten
unverändert. Hier nur, was im Pulse anders ist.

Subagent: nur lesen und berichten. Der Pulse schreibt.

## Quellen

1. **Palast** (Hilfsabfragen aus `funken.md` Abschnitt 2): Wiederholung, Schlummer (> 21 Tage),
   Lücke (offene Fragen seit Wochen).
2. **Kombination über Türen**: Bestehende `doors`, besonders `kombinierbar` und `verwandt`, sind
   die stärksten Startpunkte. Eine Tür zwischen zwei Interessen, aus der noch nie ein Funke oder eine
   Aufgabe wurde, ist ein Kandidat.
   ```sql
   select d.id, a.name von, b.name nach, d.relation, d.note,
     exists (select 1 from spark_evidence se1 join spark_evidence se2 on se1.spark_id = se2.spark_id
             where se1.place_id = d.from_place and se2.place_id = d.to_place) schon_funke
   from doors d join places a on a.id = d.from_place join places b on b.id = d.to_place
   where d.relation in ('kombinierbar', 'verwandt');
   ```
   Orte in verschiedenen Räumen mit inhaltlicher Nähe **ohne** Tür → Funke mit
   `signal = 'kombination'`. Die Tür selbst schlägt der Palast-Pflege-Baustein vor.
3. **Leben-OS-Signale** (seit letztem Lauf): Aufgaben mit `task_feedback.rating` 4–5, deren Thema
   im Palast noch keine Schublade oder keinen `next_step` hat; wiederholt angenommene
   Folgevorschläge in einem Thema; `daily_reflections`, wo gute Tage mit einem bestimmten Thema
   zusammenfallen.

## Pulse-Besonderheiten

- Der User ist beim Lauf meist nicht dabei. Funken werden deshalb mit `status = 'neu'` angelegt
  (nicht `besprochen`) und in der Pulse-Rückmeldung in einem Satz gepitcht. Bewertet er sie dort
  oder im nächsten Gespräch, gilt der normale Statusfluss.
- Max. 3 pro Lauf, der beste zuerst. Vorher Trefferquote (`funken.md` Abschnitt 4) und verworfene
  Funken prüfen.
- Ist ein Funke klein genug für einen direkten Start, meldet der Bericht die `starter_task` mit.
  Ob daraus sofort eine Aufgabe wird, entscheidet der Pulse zusammen mit dem MSGA-Baustein
  (max. 1 Erstaufgabe pro Lauf).
- Jeder Funke braucht `spark_evidence`. Ohne Belege kein Funke.
