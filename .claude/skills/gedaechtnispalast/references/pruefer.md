# Prüfer: Kontrolle nach dem Einräumen

Der Prüfer ist ein zweiter Blick auf das, was beim Einräumen passiert ist. Er läuft als Sub-Agent in einer eigenen Session, startet mit der Übergabe (SKILL.md Abschnitt 8) als Kontext und arbeitet nur mit ihr und der Datenbank, nicht mit dem Gedächtnis des Gesprächs. Er soll Fehler finden, die dem einräumenden Agenten selbst nicht auffallen – vor allem vertauschte Zuordnungen, falsche Orte und Lageberichte, die nicht mehr zum Inhalt passen.

Wenn kein zweiter Agent zur Verfügung steht (z. B. in claude.ai), führt Claude die Prüfung direkt nach dem Einräumen selbst durch – bewusst getrennt, nur anhand von Übergabe und Abfrageergebnis, als wüsste es nichts vom Gespräch.

## 1. Kontrollabfrage

Zeitfenster an den Anlass anpassen (Standard: letzte 2 Stunden).

```sql
-- Einträge: wo liegen sie wirklich?
select left(e.id::text, 8) id, coalesce(p.path::text, 'INBOX') ort, e.kind,
       left(e.body, 70) inhalt, e.created_at
from entries e left join places p on p.id = e.place_id
where e.created_at > now() - interval '2 hours'
   or e.id in (select entry_id from spark_evidence se join sparks s on s.id = se.spark_id
               where s.created_at > now() - interval '2 hours')
order by ort;

-- Orte: neu oder umgebaut, mit Füllstand
select p.path::text, p.kind, p.name,
       (select count(*) from entries e where e.place_id = p.id) eintraege,
       left(p.briefing, 80) lagebericht, p.next_step
from places p
where p.updated_at > now() - interval '2 hours'
order by p.path;

-- Funken-Belege: zeigen sie auf die gemeinten Einträge?
select s.title, left(e.body, 60) beleg, p.path::text
from sparks s join spark_evidence se on se.spark_id = s.id
left join entries e on e.id = se.entry_id
left join places p on p.id = coalesce(se.place_id, e.place_id)
where s.created_at > now() - interval '2 hours';
```

## 2. Prüfpunkte

1. **Ort passt zum Inhalt.** Der Inhalt (`inhalt`) passt zum Ort, nicht nur die ID zur Übergabe. Ein Eintrag „Rezepte: …“ in der Schublade Fernsehprogramm ist ein Fehler, egal was die Übergabe sagt.
2. **Übergabe stimmt mit der Datenbank überein.** Jede Zeile der Übergabe findet sich so in der Abfrage wieder, nichts fehlt, nichts ist zusätzlich.
3. **Granularität.** Tabspezifisches liegt in der Tab-Schublade, Übergreifendes im übergeordneten Ort. Nichts liegt im Raum selbst, wenn es eine passende Schublade gibt.
4. **`kind` stimmt.** Wunsch/Vorschlag = idee, Beobachtung eines Problems = feedback, festgelegter Ablauf = entscheidung, offene Frage = frage.
5. **Keine Dubletten.** Derselbe Gedanke liegt nicht doppelt; Verbindungen laufen über Türen.
6. **Lageberichte aktuell.** `briefing` und `next_step` der betroffenen Orte spiegeln die neuen Einträge; der `next_step` ist eine konkrete Handlung.
7. **Umbauten erfüllen die Kriterien** aus SKILL.md Abschnitt 3. Neue Räume, Umbenennungen, Zusammenlegungen und Archivierungen dürfen nicht ohne Bestätigung passiert sein.
8. **Türen und Funken-Belege** zeigen auf die richtigen Orte bzw. Einträge.
9. **Die „Unsicher“-Fälle** aus der Übergabe bekommen eine eigene, begründete Entscheidung.

## 3. Was der Prüfer tun darf

- **Selbst korrigieren**: eindeutige Fehler – vertauschte Zuordnungen, Eintrag im falschen Ort bei klarem richtigen Ort, falsche Funken-Belege, veralteter Lagebericht. Immer über den Inhalt identifizieren, nie über eine ID-Reihenfolge.
- **Nur vorschlagen**: Geschmacksfragen (zwei vertretbare Orte), Umbauten jenseits der Kriterien, alles, was Räume, Namen oder Archivstatus betrifft.

## 4. Prüfbericht

Der Bericht geht zurück an den einräumenden Agenten, der ihn dem User kurz weitergibt. Kurz, im Palast-Bild:

- Ein Satz Gesamturteil („Alles sauber“ oder „2 Einträge umgehängt“).
- Pro Korrektur eine Zeile: was lag wo, wo liegt es jetzt, warum.
- Vorschläge, die er bestätigen soll, als kurze Liste.
- Höchstens eine Frage.

Wiederkehrende Fehlerarten (z. B. immer wieder falsche Granularität) als `erkenntnis` in Werkstatt › Arbeitsprinzipien ablegen, damit der einräumende Agent daraus lernt.
