do $$
begin
  if to_regprocedure('public.claim_analysis_job(uuid,integer,integer)') is not null
    or to_regprocedure('public.reap_analysis_jobs(integer,integer)') is not null
    or to_regprocedure('public.renew_analysis_job_lease(uuid,uuid,integer)') is not null
    or to_regprocedure('public.fail_analysis_job(uuid,uuid)') is not null
    or exists (select 1 from pg_trigger
      where tgname = 'analysis_job_live_lease_completion' and not tgisinternal) then
    raise exception 'Issue #20 rollback left lease functions or trigger';
  end if;
end;
$$;
