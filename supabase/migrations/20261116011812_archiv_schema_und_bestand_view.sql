-- Auftrag b9b28dfd (Bauplan 7b88a98d Schritt 3, Regel c9fe0406): Archivraum im Leben OS.
-- Statt drop/delete wird Altes per "alter ... set schema archiv" hierher geschoben und mit
-- comment on ... is 'archiviert JJJJ-MM-TT: Grund' markiert. Das Schema existiert schon seit
-- dem Bereiche-Umbau vom 15.11.2026 (Sicherungen areas_20261115, tasks_bereiche_20261115).
create schema if not exists archiv;

comment on schema archiv is
  'Archivraum (Regel c9fe0406): Altes wird hierher verschoben statt gelöscht. Bestand über public.archiv_bestand.';

-- Gleiche Form wie im Palast (zbafgyvqxexqrjddrvsm), damit das Weekly beide gleich zählt.
create or replace view public.archiv_bestand with (security_invoker = true) as
select objektart, name, kommentar,
  to_date(substring(kommentar from 'archiviert (\d{4}-\d{2}-\d{2})'), 'YYYY-MM-DD') as archiviert_am
from (
  select case p.prokind when 'p' then 'prozedur' when 'a' then 'aggregat' else 'funktion' end as objektart,
    p.oid::regprocedure::text as name,
    obj_description(p.oid, 'pg_proc') as kommentar
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'archiv'
  union all
  select case c.relkind when 'r' then 'tabelle' when 'p' then 'tabelle' when 'v' then 'view'
      when 'm' then 'mat_view' when 'S' then 'sequenz' else c.relkind::text end,
    'archiv.' || c.relname::text,
    obj_description(c.oid, 'pg_class')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'archiv' and c.relkind in ('r', 'v', 'm', 'S', 'p')
) o;

comment on view public.archiv_bestand is
  'Was im Schema archiv liegt. Datum kommt aus dem Kommentar: beim Archivieren comment on ... is ''archiviert JJJJ-MM-TT: Grund'' setzen (Bauplan 7b88a98d).';

-- Nur für Service-Role/MCP (Weekly), nicht über den öffentlichen anon key der App.
revoke all on public.archiv_bestand from anon, authenticated;
grant select on public.archiv_bestand to service_role;
