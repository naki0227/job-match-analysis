do $$
begin
  if to_regclass('public.job_discovery_requests') is not null
    or to_regclass('public.job_resolver_events') is not null
    or to_regprocedure('public.claim_job_discovery(uuid,integer,integer)') is not null
    or to_regclass('public.job_postings') is null then
    raise exception 'job discovery rollback is incomplete or removed postings';
  end if;
end;
$$;
