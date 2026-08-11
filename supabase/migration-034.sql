-- Leben OS — Migration 034
-- Gedanken-Status um 'unclear' erweitern (Pulse-Router / Rückfrage-Bento, siehe
-- wissensdatenbank/leben-os-betriebsmodell.md, "Der Pulse-Router").
--
-- Kann der Pulse einen rohen Gedanken nicht sicher einordnen (eine der drei Klarheits-Dimensionen
-- wackelt), setzt er status='unclear' + routing_note='Kandidaten: …'. Diese Gedanken erscheinen als
-- Cockpit-Kachel "Gedanken zum Klären"; tippt der Nutzer einen Kandidaten, wandert der Gedanke mit
-- routing_note='Nutzerwahl: …' zurück auf 'raw', und der nächste Pulse routet ihn entsprechend.

alter table thoughts drop constraint if exists thoughts_status_check;
alter table thoughts add constraint thoughts_status_check
  check (status in ('raw', 'processed', 'unclear'));
