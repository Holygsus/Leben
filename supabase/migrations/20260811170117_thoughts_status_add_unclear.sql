alter table thoughts drop constraint if exists thoughts_status_check;
alter table thoughts add constraint thoughts_status_check
  check (status in ('raw', 'processed', 'unclear'));