-- Leben OS — Migration 016
-- Einmalig im Supabase SQL Editor ausführen (Project → SQL Editor → New query → Run)
--
-- Notizen/Kommentare zu Aufgaben (siehe wissensdatenbank/features/task-comments.md, Variante B) —
-- spontane Gedanken beim erneuten Betrachten einer Aufgabe, ohne eigenes Bearbeitungsfeld.

create table if not exists task_comments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  task_id uuid references tasks(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now()
);

create index if not exists task_comments_task_id_idx on task_comments (task_id);

alter table task_comments enable row level security;
drop policy if exists "task_comments: own data" on task_comments;
create policy "task_comments: own data" on task_comments for all using (auth.uid() = user_id);
