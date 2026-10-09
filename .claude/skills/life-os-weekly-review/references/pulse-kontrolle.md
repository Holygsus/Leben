# Pulse- und MSGA-Kontrolle im Weekly

Der Pulse (Skill `life-os-pulse`) läuft täglich und schlägt vor. Das Weekly schaut einmal pro Woche
drauf, ob das, was er vorschlägt, wirklich trägt. Ton wie im übrigen Weekly: Fakt, konkrete Titel,
Konsequenz direkt dran. Kurz, wenn alles läuft.

Leben OS: `eimyiymmqciiyxaqluzc`, Palast: `zbafgyvqxexqrjddrvsm`. Lauf-Spur: Palast-Schublade
*Werkstatt › Pulse-Log*.

## 1. Lief der Pulse?

```sql
-- Palast
select occurred_at::date tag, body from entries e join places p on p.id = e.place_id
where p.slug = 'pulse_log' and e.occurred_at > now() - interval '7 days' order by 1;
```
Lücken von mehreren Tagen benennen. Liegen `pending`-Aufgaben älter als 2 Tage herum, ist das ein
Zeichen, dass der Pulse nicht lief:
```sql
-- Leben OS
select count(*), min(updated_at) from tasks
where user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2' and followup_status = 'pending';
```

## 2. Folgevorschläge: Treffer pro Rahmen

```sql
select coalesce(frame, '–') frame, count(*) angeboten,
  sum((status = 'accepted')::int) uebernommen, sum((status = 'dismissed')::int) verworfen,
  sum((status in ('open', 'muted'))::int) offen
from task_followup_suggestions
where user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2' and created_at > now() - interval '28 days'
group by 1 order by 2 desc;
```
Lesen:
- Ein Rahmen, der nie übernommen wird → weniger davon (Stellschraube unten).
- Viele offene Vorschläge, die tagelang im Popup liegen → zu viele pro Aufgabe, Popup wird
  weggedrückt.
- Übernommene Folgeaufgaben, die danach nicht erledigt werden → Schritte zu groß.

```sql
-- Übernommen, aber liegen geblieben
select t.title, t.created_at::date from tasks t
where t.user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2' and t.followup_source_id is not null
  and t.status <> 'done' and t.created_at < now() - interval '14 days';
```

Kernkennzahl (Referenz August 2026: 73 % übernommen, 8 % davon erledigt):
```sql
select count(*) filter (where followup_source_id is not null) uebernommen,
  count(*) filter (where followup_source_id is not null and status = 'done') erledigt,
  count(*) filter (where status <> 'done') offen_gesamt
from tasks where user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2';
```
Steigt „offen“ schneller als „erledigt“, greift die Wachstumsbremse zu spät → Schwelle senken.

Schrittart pro Bereich: Welche Rahmen werden in welchem Bereich übernommen **und erledigt**? Das
ist bereichsabhängig (Recherche kann bei Weiterbildung tragen und bei Musik Rauschen sein). Daraus
pro Bereich die bevorzugte Schrittart als Stellschraube festhalten, nicht pauschal.
```sql
select a.name bereich, s.frame, count(*) angeboten, sum((s.status = 'accepted')::int) uebernommen,
  sum((t.status = 'done')::int) erledigt
from task_followup_suggestions s left join areas a on a.id = s.area_id
left join tasks t on t.followup_source_id = s.source_task_id and t.title = s.title
where s.user_id = '715a6a5a-7739-4b1a-b34d-508ac39d6dc2' and s.created_at > now() - interval '28 days'
group by 1, 2 order by 1, 3 desc;
```

## 3. Boss-Level

Aus derselben Abfrage die Zeile `Boss-Level`: Wie viele angeboten, übernommen, erledigt? Erledigte
Boss-Level mit guter Bewertung sind der stärkste Gegenbeweis gegen die Klein-machen-Tendenz des
Users. Genau so benennen. Dauernd verworfene Boss-Level → Schwelle oder Größe anpassen.

## 4. MSGA und Funken

```sql
-- Palast: Funken der Woche und ihr Schicksal
select title, kind, signal, status, rating from sparks where created_at > now() - interval '7 days';
```
- MSGA-Aufgaben (über `anchors`/`sparks.lifeos_task_id`) erledigt, offen, ignoriert?
- Komfortzonen-Schritte: angenommen oder umgangen? Wiederholtes Umgehen desselben Typs →
  Komfortzonen-Regel (wiedervorlegen mit Nachdruck, nicht still entfernen), außer das Interesse
  ist laut User erloschen.
- Funken-Bewertungen dieser Woche wandern als bestätigte/widersprochene Thesen in die
  Weekly-Feedback-Notiz.

## 5. Stellschrauben

Bestätigt der User eine Anpassung, wird sie wie jede Skill-Anpassung festgehalten (Abschnitt 6 im
Weekly: konkret, für die nächste Überarbeitung von `life-os-pulse`). Typische Stellschrauben:
- Anzahl Vorschläge pro Aufgabe (Standard 0–5)
- Rahmen bevorzugen oder meiden
- Boss-Level-Schwelle (Standard: Bewertung 4–5) und Größe (Standard: effort 60)
- MSGA-Takt (Standard: max. 1 Erstaufgabe + 1 Komfortzonen-Schritt pro Lauf)
- Funken-Limit (Standard: max. 3 pro Lauf)

Einzelne Ausreißer nicht sofort thematisieren. Erst wenn sich über mehrere Weeklys ein Muster zeigt
(Weekly-Feedback-Notizen), als eigene Beobachtung mit Anpassungsvorschlag.
