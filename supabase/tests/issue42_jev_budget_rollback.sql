do $$
begin
  if to_regclass('public.jev_daily_usage') is not null
    or to_regprocedure('public.reserve_jev_budget(integer,integer)') is not null then
    raise exception 'Issue #42 Jev budget rollback left objects';
  end if;
end;
$$;
