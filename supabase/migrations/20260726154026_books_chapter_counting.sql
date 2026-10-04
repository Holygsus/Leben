alter table books
  add column if not exists progress_unit text not null default 'chapters'
    check (progress_unit in ('pages', 'chapters')),
  add column if not exists total_chapters integer,
  add column if not exists current_chapter integer not null default 0;

alter table book_reading_log
  add column if not exists chapters_read integer;

alter table book_reading_log
  alter column pages_read drop not null;