-- Leben OS — Migration 026
-- NOCH NICHT angewendet — im Supabase SQL Editor / via MCP ausführen, danach diesen Kopf aktualisieren.
--
-- Zähl-Habits / mengen-basierte Habits (wissensdatenbank/features/habit-tracker.md,
-- War-Room-Update 2026-07-28). Neben dem binären Ja/Nein-Habit ein zweiter Typ "Zähler":
-- jede Einheit per +-Tap erfassen, sammeln, Durchschnitt zeigen — kein Tagesurteil.
--
-- tasks.habit_unit gesetzt = Zähl-Habit (speichert das Einheiten-Label, z. B. "Glas"/"Zigarette").
-- Ein Zähl-Habit wird mit habit_weekdays = '{}' angelegt (bleibt damit isHabitTask==true, taucht im
-- Habit-Tab auf, wird aber nie in den Tagesplan eingeplant, siehe findHabitsDueToday).
alter table tasks add column if not exists habit_unit text;

-- Bewusst NICHT habit_completions wiederverwenden: dessen unique(task_id, date) trägt die Idempotenz
-- der binären Habits (Upsert/Delete in js/tasks.js). Ein Zähl-Habit braucht MEHRERE Zeilen pro Tag
-- (eine je Tap), daher eine eigene, constraint-freie Log-Tabelle. Tagesmenge = sum(amount) je Tag,
-- Weekly-Schnitt = Durchschnitt über den Zeitraum.
create table if not exists habit_counter_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  date date not null,
  amount numeric not null default 1,
  created_at timestamptz default now()
);

create index if not exists habit_counter_log_task_id_idx on habit_counter_log (task_id);

alter table habit_counter_log enable row level security;
drop policy if exists "habit_counter_log: own data" on habit_counter_log;
create policy "habit_counter_log: own data" on habit_counter_log for all using (auth.uid() = user_id);
