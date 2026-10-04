ALTER TABLE habit_completions
  ADD COLUMN IF NOT EXISTS skipped boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS note text;