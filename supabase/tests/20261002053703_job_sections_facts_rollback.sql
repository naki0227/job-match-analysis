do $$
begin
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'evaluation_job_facts_kind_check')) like '%workStyle%' then
    raise exception 'section kinds are still allowed after rollback';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'evaluation_job_facts_kind_check')) not like '%employmentType%' then
    raise exception 'rollback removed employmentType';
  end if;
  if pg_get_functiondef('public.commit_analysis_evaluation_v2(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure)
      like '%workStyle%' then
    raise exception 'commit_analysis_evaluation_v2 still accepts section facts';
  end if;
end;
$$;
