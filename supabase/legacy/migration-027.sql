-- Leben OS — Migration 027
-- Folgeaufgaben-Vorschläge nach Aufgaben-Abschluss
-- (wissensdatenbank/features/folgeaufgaben-vorschlaege.md, War Room 2026-07-29).
--
-- Nach dem Abschließen einer Aufgabe schlägt ein manuell ausgelöster Skill bis zu 5 Folgeaufgaben
-- vor (je mit Rahmen-Label). Keine Persistenz eines Turnierbaums — jeder Skill-Lauf analysiert den
-- Familienbaum frisch. Diese Migration legt die Trägerstrukturen an.

-- tasks: Steuer-Flag für den Folgeaufgaben-Skill.
--   'pending'   = abgeschlossen, wartet auf Analyse durch den Skill
--   'suggested' = hat offene Vorschläge → der Skill fasst die Aufgabe nicht erneut an
--   'closed'    = 0 gewählt oder bearbeitet → nie wieder Vorschläge
--   NULL        = normal / nicht abgeschlossen
alter table tasks add column if not exists followup_status text
  check (followup_status in ('pending', 'suggested', 'closed'));

-- Lineage der Folgeaufgaben-Kette. BEWUSST getrennt von parent_task_id: eine übernommene
-- Folgeaufgabe ist eine echte Top-Level-Aufgabe (Tagesplan-Kandidat), kein Subtask — der Planner
-- filtert auf !parent_task_id (js/planner.js). Über diese Spalte rekonstruiert der Skill den Baum.
alter table tasks add column if not exists followup_source_id uuid references tasks(id) on delete set null;

create index if not exists tasks_followup_source_id_idx on tasks (followup_source_id);
create index if not exists tasks_followup_status_idx on tasks (followup_status);

-- Aktuell offene Vorschläge zur Anzeige im "Neue Vorschläge"-Popup. Kein wiederkehrender Vorrat —
-- bei jedem Lauf frisch erzeugt. effort mitführen, damit eine übernommene Aufgabe direkt
-- plan-tauglich ist (Aufgabe ohne effort fällt aus dem Tagesplan).
create table if not exists task_followup_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  source_task_id uuid references tasks(id) on delete cascade not null,
  area_id uuid references areas on delete set null,
  title text not null,
  frame text,
  effort integer check (effort in (5, 10, 30, 60)),
  status text default 'open' check (status in ('open', 'accepted', 'dismissed')),
  created_at timestamptz default now()
);

create index if not exists task_followup_suggestions_source_task_id_idx
  on task_followup_suggestions (source_task_id);
create index if not exists task_followup_suggestions_user_status_idx
  on task_followup_suggestions (user_id, status);

-- Weicher Themen-Dämpfer: wie oft ein Vorschlags-Thema angeboten-und-nie-gewählt wurde. Kein
-- Zähler, der Wiederholungen erzwingt — fließt nur als Dämpfer in die nächste Bewertung des Skills.
-- Wird ausschließlich vom Skill gelesen/geschrieben, die App fasst diese Tabelle nicht an.
create table if not exists followup_topic_tally (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  topic text not null,
  offered_count integer default 0,
  last_offered_at timestamptz,
  unique (user_id, topic)
);

alter table task_followup_suggestions enable row level security;
drop policy if exists "task_followup_suggestions: own data" on task_followup_suggestions;
create policy "task_followup_suggestions: own data" on task_followup_suggestions
  for all using (auth.uid() = user_id);

alter table followup_topic_tally enable row level security;
drop policy if exists "followup_topic_tally: own data" on followup_topic_tally;
create policy "followup_topic_tally: own data" on followup_topic_tally
  for all using (auth.uid() = user_id);
