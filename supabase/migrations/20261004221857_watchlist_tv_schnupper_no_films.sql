do $m$
declare def text;
begin
  def := pg_get_functiondef('public.build_broadcast_week(date,uuid)'::regprocedure);
  def := replace(def,
    $a$when 'schnupper' then w.status in ('kandidat','geplant','irgendwann')$a$,
    $b$when 'schnupper' then w.type <> 'film' and w.status in ('kandidat','geplant','irgendwann')$b$);
  if position($c$w.type <> 'film' and w.status$c$ in def) = 0 then raise exception 'patch fehlgeschlagen'; end if;
  execute def;
end $m$;