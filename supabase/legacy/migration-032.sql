-- Leben OS — Migration 032
-- Gedanken-Eingang (`thoughts`) — Fundament des Betriebsmodells (siehe
-- wissensdatenbank/leben-os-betriebsmodell.md, Abschnitt "Der Gedanken-Eingang").
--
-- Ein `thought` ist rohes, noch UNklassifiziertes Material — bewusst KEINE Aufgabe (das ist
-- is_brainstorm). Der Daily Pulse (eigener Skill) liest hier `status='raw'`, klassifiziert/routet und
-- setzt `status='processed'` mit einem Ergebnisverweis (resulted_in_task_id bzw. routing_note) —
-- nicht gelöscht, damit eine Fehlzuordnung nachvollziehbar/korrigierbar bleibt.

create table if not exists thoughts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  body text not null,
  status text not null default 'raw' check (status in ('raw', 'processed')),
  -- Ergebnisverweis: Aufgabe, die aus dem Gedanken wurde (Auto-Route in tasks) …
  resulted_in_task_id uuid references tasks(id) on delete set null,
  -- … oder freie Routing-Notiz für Nicht-Aufgaben-Ziele (z. B. "→ interessen-beobachtung.md").
  routing_note text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create index if not exists thoughts_user_status_idx on thoughts (user_id, status);

alter table thoughts enable row level security;

drop policy if exists "thoughts: own data" on thoughts;
create policy "thoughts: own data" on thoughts for all using (auth.uid() = user_id);
