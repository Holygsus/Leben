-- Leben OS — Migration 033
-- Task-Feedback (`task_feedback`) — Betriebsmodell (siehe wissensdatenbank/leben-os-betriebsmodell.md,
-- Abschnitt "Task-Feedback").
--
-- Beim Abschluss einer Aufgabe ein leichtes Rating (1–5, wie daily_reflections.mood — NICHT 1–10 wie
-- watchlist_viewing_log) + optionale Notiz. Zweck: Lern-Treibstoff, der sich durch den
-- Folgeaufgaben-Familienbaum zieht; die Notiz trägt das Ergebnis weiter ("September 2026"). Die
-- Deutung macht ein Skill (QoL/Weekly/Pulse), nicht die App. unique(task_id) = ein Feedback pro
-- Aufgabe. Habits/Watchlist sind ausgenommen (App-seitig), daher hier kein Sonderfeld nötig.

create table if not exists task_feedback (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  rating int not null check (rating between 1 and 5),
  note text,
  created_at timestamptz default now(),
  unique (task_id)
);

create index if not exists task_feedback_user_id_idx on task_feedback (user_id);

alter table task_feedback enable row level security;

drop policy if exists "task_feedback: own data" on task_feedback;
create policy "task_feedback: own data" on task_feedback for all using (auth.uid() = user_id);
