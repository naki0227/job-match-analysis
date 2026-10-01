do $$
begin
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'evaluation_job_facts_kind_check')) like '%employmentType%' then
    raise exception 'employmentType kind is still allowed after rollback';
  end if;
  if pg_get_functiondef('public.commit_analysis_evaluation_v2(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure)
      like '%employmentType%' then
    raise exception 'commit_analysis_evaluation_v2 still accepts employmentType';
  end if;
end;
$$;
