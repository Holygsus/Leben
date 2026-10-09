# SQL-Rezepte für den Palast

Palast-Projekt: `zbafgyvqxexqrjddrvsm`. Texte vom User immer mit Dollar-Quoting einsetzen (`$t$...$t$`), damit Apostrophe nichts kaputt machen.

**Kein Semikolon in Texten von INSERT/UPDATE**, auch nicht innerhalb von `$t$...$t$`: Der Supabase-MCP hängt sich daran auf (60-s-Timeout, die Änderung kommt nie an). Komma oder Punkt verwenden, notfalls `|| chr(59) ||`. Lesende Abfragen sind nicht betroffen. Auch `DELETE` hängt (der MCP verlangt eine Bestätigung, die nicht erscheint), was zur Regel „nie löschen“ passt: umformulieren oder archivieren.

## Inhalt
1. Nachschlagen
2. Einräumen
3. Umbauen
4. Lagebericht
5. Übersichten

## 1. Nachschlagen

```sql
select * from palace_lookup($t$black clover$t$, 5);
```
Liefert `id, path, kind, name, status, score, briefing, next_step`. Eindeutig = ein Treffer klar vorne (deutlich höherer `score`) oder exakter Name-/Alias-Treffer.

Kontext holen und Besuch vermerken in einem Rutsch:
```sql
update places set last_visited_at = now() where id = '<id>';
select palace_context('<id>');
```
`palace_context` liefert `ort, weg, inhalt, tueren, eintraege (letzte 15), anker, offene_funken`.

## 2. Einräumen

```sql
insert into entries (place_id, kind, body, url, source)
values ('<place_id oder null>', 'erkenntnis', $t$...$t$, null, 'chat')
returning id;
```
Inbox = `place_id null`.

Tür zwischen zwei Orten:
```sql
insert into doors (from_place, to_place, relation, note)
values ('<a>', '<b>', 'kombinierbar', $t$...$t$)
on conflict do nothing;
```
Relationen: verwandt, baut_auf, kombinierbar, widerspricht, loest, quelle_fuer.

## 3. Umbauen

Neuer Ort (Raum hat kein parent; Schrank/Schublade brauchen eins):
```sql
insert into places (kind, parent_id, slug, name, icon, briefing, next_step)
values ('schublade', '<parent_id>', 'hades_2', 'Hades 2', '🔥', $t$...$t$, $t$...$t$)
returning id, path;
```

Verschieben (Pfad inkl. Unterorte zieht der Trigger nach):
```sql
update places set parent_id = '<neuer_parent>' where id = '<id>';
```

Umbenennen mit Alias:
```sql
update places
set aliases = array_append(aliases, name), name = $t$Neuer Name$t$
where id = '<id>';
```

Archivieren statt löschen:
```sql
update places set status = 'archiviert' where id = '<id>';
```

Schrank-Kandidaten (3+ Schubladen direkt in einem Raum):
```sql
select r.name raum, count(*) schubladen, array_agg(s.name) namen
from places s join places r on r.id = s.parent_id
where s.kind = 'schublade' and r.kind = 'raum' and s.status <> 'archiviert'
group by r.name having count(*) >= 3;
```
Ob sie ein gemeinsames Thema haben, entscheidest du inhaltlich.

## 4. Lagebericht

```sql
update places set
  briefing = $t$...$t$,
  open_questions = array[$t$Frage 1$t$, $t$Frage 2$t$],
  next_step = $t$...$t$
where id = '<id>';
```

## 5. Übersichten

```sql
select * from palace_map;          -- ganzer Grundriss mit Einträge-Zahl
select * from inbox;               -- unsortierte Einträge
select * from dormant_places limit 10;  -- aktive Schubladen, am längsten unberührt zuerst
select * from open_sparks;         -- Funken neu/besprochen/angenommen mit Belegen
```
