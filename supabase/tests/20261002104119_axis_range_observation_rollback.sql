do $$
begin
  if exists (select 1 from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'evaluated_axis_values' and column_name = 'anchor_max')
          or (table_name = 'match_axis_results'
            and column_name in ('observed_anchor_max', 'difference_max')))) then
    raise exception 'range columns remain after rollback';
  end if;
  if pg_get_functiondef('public.evaluation_match_snapshot(uuid)'::regprocedure)
      like '%anchorMax%' then
    raise exception 'evaluation_match_snapshot still returns anchorMax';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'match_axis_results_comparison_status_check')) like '%partial%' then
    raise exception 'partial comparisons are still allowed after rollback';
  end if;
end;
$$;
