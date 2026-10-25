create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table backup.tasks_20261009 as select * from public.tasks;
create table backup.task_feedback_20261009 as select * from public.task_feedback;
create table backup.task_followup_suggestions_20261009 as select * from public.task_followup_suggestions;
create table backup.habit_completions_20261009 as select * from public.habit_completions;
create table backup.habit_counter_log_20261009 as select * from public.habit_counter_log;
create table backup.task_comments_20261009 as select * from public.task_comments;