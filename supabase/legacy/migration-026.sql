-- Habit-Completions: Skip-Eintrag und optionale Notiz
-- Ermöglicht das explizite Markieren eines nicht gemachten Habits ("Nicht gemacht"-Button in
-- der Heute-Ansicht) als separaten Skip-Eintrag, der vom Weekly ausgewertet werden kann
-- (z.B. "war krank", "war unterwegs") und die Habit-Streak korrekt unterbricht.
-- Ausgeführt: 2026-08-13 via Supabase MCP
ALTER TABLE habit_completions
  ADD COLUMN IF NOT EXISTS skipped boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS note text;
