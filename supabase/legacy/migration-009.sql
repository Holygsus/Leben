-- Leben OS — Migration 009
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Habit Tracker V2 (siehe wissensdatenbank/features/habit-tracker.md):
-- 1) Aufgaben-Pool pro Habit — nutzt bestehendes tasks.parent_task_id, keine Schemaänderung nötig.
-- 2) Wiederholungsintervall: habit_recurrence + habit_last_due_date als Fälligkeits-Anker.
-- 3) Streak-Tracking (nur Datenmodell): habit_completions-Log, eine Zeile pro Tag/Habit. Sichtbare
--    Anzeige folgt in einer späteren Runde.

alter table tasks add column if not exists habit_recurrence text default 'weekly'
  check (habit_recurrence in ('weekly', 'biweekly', 'monthly'));
-- Letzter Tag, an dem dieses Habit tatsächlich fällig wurde (nicht: zuletzt erledigt). null = noch
-- nie fällig geworden -> beim ersten Wochentags-Treffer sofort fällig (siehe isRecurrenceDue() in
-- js/habits.js). Wird ausschließlich von autoplanDueHabits() geschrieben, nie durch UI-Änderungen
-- an habit_weekdays/habit_recurrence.
alter table tasks add column if not exists habit_last_due_date date;

-- Eine Zeile pro Tag, an dem eine Habit-Mutter (direkt oder über ein Pool-Kind) erledigt wurde.
-- unique(task_id, date) macht das Logging in completeTaskCascade() idempotent (Upsert mit
-- ignoreDuplicates, analog ensureAreasSeeded in js/auth.js).
create table if not exists habit_completions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  date date not null,
  created_at timestamptz default now(),
  unique (task_id, date)
);

create index if not exists habit_completions_task_id_idx on habit_completions (task_id);

alter table habit_completions enable row level security;
drop policy if exists "habit_completions: own data" on habit_completions;
create policy "habit_completions: own data" on habit_completions for all using (auth.uid() = user_id);
