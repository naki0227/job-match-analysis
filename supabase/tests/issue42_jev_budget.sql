-- Issue #42: the daily Jev budget is all-or-nothing and never overshoots.
do $$
begin
  if not public.reserve_jev_budget(3, 5) then
    raise exception 'first reservation within budget was refused';
  end if;
  if public.reserve_jev_budget(3, 5) then
    raise exception 'reservation beyond the budget was granted';
  end if;
  if not public.reserve_jev_budget(2, 5) then
    raise exception 'exact remaining budget was refused';
  end if;
  if public.reserve_jev_budget(1, 5) then
    raise exception 'exhausted budget granted another unit';
  end if;
  if (select reserved_units from public.jev_daily_usage) <> 5
    or (select count(*) from public.jev_daily_usage) <> 1 then
    raise exception 'Budget usage was not recorded once per day';
  end if;
  -- A raised limit (setting change) allows more calls the same day.
  if not public.reserve_jev_budget(1, 6) then
    raise exception 'raised limit was ignored';
  end if;
  begin
    perform public.reserve_jev_budget(0, 5);
    raise exception 'zero units accepted';
  exception when invalid_parameter_value then null;
  end;
  if has_function_privilege('authenticated',
      'public.reserve_jev_budget(integer,integer)', 'EXECUTE')
    or has_table_privilege('anon', 'public.jev_daily_usage', 'SELECT') then
    raise exception 'Jev budget is exposed to clients';
  end if;
  delete from public.jev_daily_usage;
end;
$$;
