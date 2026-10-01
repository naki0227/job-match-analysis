do $$
declare
  v_source uuid;
  v_job uuid;
  v_claim record;
  v_old uuid := '42500000-0000-4000-8000-000000000001';
  v_new uuid := '42500000-0000-4000-8000-000000000002';
begin
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://example.org/immediate-retry', 'https://example.org/immediate-retry')
    returning id into v_source;
  insert into public.analysis_jobs(source_url_id, analyzer_version, status)
    values (v_source, 'immediate-retry-v1', 'queued')
    returning id into v_job;

  select * into v_claim from public.claim_analysis_job(v_old, 600, 3);
  if v_claim.job_id is distinct from v_job or v_claim.attempts <> 1 then
    raise exception 'retry test job was not claimed';
  end if;

  if public.requeue_analysis_job(v_job, v_new) then
    raise exception 'wrong token requeued the job';
  end if;
  if not public.requeue_analysis_job(v_job, v_old) then
    raise exception 'live claim was not requeued';
  end if;

  if (select status from public.analysis_jobs where id = v_job) <> 'queued'
    or (select worker_token from public.analysis_jobs where id = v_job) is not null
    or (select lease_until from public.analysis_jobs where id = v_job) is not null
    or (select attempts from public.analysis_jobs where id = v_job) <> 1 then
    raise exception 'requeue did not preserve the retry counter and clear the lease';
  end if;

  select * into v_claim from public.claim_analysis_job(v_new, 600, 3);
  if v_claim.job_id is distinct from v_job or v_claim.attempts <> 2 then
    raise exception 'requeued job was not immediately claimable';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('anon',
      'public.requeue_analysis_job(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.requeue_analysis_job(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role',
      'public.requeue_analysis_job(uuid,uuid)', 'EXECUTE') then
    raise exception 'Job requeue RPC privilege mismatch';
  end if;
end;
$$;
