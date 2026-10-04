-- Leben OS — Migration 006
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Ergänzt unique(user_id, name) auf modules. getFinanceModuleSettings() in js/finance.js macht
-- ein Get-or-create auf (user_id, name='finanzplan') per .maybeSingle() — ohne diesen Constraint
-- könnten zwei parallele erste Ladevorgänge je eine Zeile anlegen, woraufhin jede weitere Abfrage
-- an der Mehrdeutigkeit scheitert und die komplette Finanzen-Ansicht nicht mehr lädt.
--
-- Falls durch das beschriebene Race bereits Duplikate existieren, vorher bereinigen (pro
-- user_id+name nur die älteste Zeile behalten):
--
-- delete from modules m using modules newer
--   where m.user_id = newer.user_id and m.name = newer.name
--   and m.created_at > newer.created_at;

alter table modules add constraint modules_user_name_unique unique (user_id, name);
