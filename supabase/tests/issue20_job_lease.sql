do $$
declare
  v_source uuid;
  v_job uuid;
  v_second_job uuid;
  v_third_job uuid;
  v_target uuid;
  v_token_old uuid := '20000000-0000-4000-8000-000000000001';
  v_token_new uuid := '20000000-0000-4000-8000-000000000002';
  v_token_expired uuid := '20000000-0000-4000-8000-000000000003';
  v_token_reclaimed uuid := '20000000-0000-4000-8000-000000000004';
  v_token_failed uuid := '20000000-0000-4000-8000-000000000005';
  v_claim record;
  v_axes jsonb;
  v_documents jsonb;
  v_payload jsonb;
  v_evaluation uuid;
  v_failed boolean;
begin
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://example.org/issue20', 'https://example.org/issue20')
    returning id into v_source;
  insert into public.analysis_jobs(source_url_id, analyzer_version, status, created_at)
    values (v_source, 'issue20-v1', 'queued', '2020-01-01T00:00:00Z')
    returning id into v_job;
  select * into v_claim from public.claim_analysis_job(v_token_old, 60, 2);
  if v_claim.job_id is distinct from v_job or v_claim.attempts <> 1
    or v_claim.lease_until <= now()
    or (select status from public.analysis_jobs where id = v_job) <> 'running' then
    raise exception 'Atomic claim did not assign a live token and lease';
  end if;
  if not public.renew_analysis_job_lease(v_job, v_token_old, 60)
    or public.renew_analysis_job_lease(v_job, v_token_new, 60)
    or public.fail_analysis_job(v_job, v_token_new) then
    raise exception 'Lease ownership check failed';
  end if;

  update public.analysis_jobs set lease_until = now() - interval '1 second'
    where id = v_job;
  select * into v_claim from public.claim_analysis_job(v_token_new, 60, 2);
  if v_claim.job_id is distinct from v_job or v_claim.attempts <> 2
    or public.renew_analysis_job_lease(v_job, v_token_old, 60)
    or public.fail_analysis_job(v_job, v_token_old) then
    raise exception 'Expired claim was not reclaimed with a new token';
  end if;

  insert into public.companies(name) values ('Issue 20 Sample');
  insert into public.evaluation_targets(target_type, company_id)
    select 'company', id from public.companies where name = 'Issue 20 Sample'
    returning id into v_target;
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1,
    'observationStatus', 'unknown', 'anchorValue', null
  ) order by axis_key) into v_axes
  from public.assessment_axes where axis_version = 1;
  v_documents := jsonb_build_array(jsonb_build_object(
    'sourceUrlId', v_source, 'contentHash', 'issue20-content',
    'fetchedAt', '2026-09-29T00:00:00Z', 'extractorVersion', 'v1',
    'extractedText', 'sample source text'
  ));
  v_payload := jsonb_build_object(
    'axisCatalogVersion', 1, 'sourceSetHash', 'issue20-source-set',
    'rubricVersion', 'r1', 'evaluatorVersion', 'e1', 'modelVersion', 'm1',
    'axisValues', v_axes, 'evidence', '[]'::jsonb
  );
  begin
    perform public.commit_analysis_evaluation(
      v_job, v_token_old, v_target, v_documents, v_payload);
    raise exception 'Old token completed a reclaimed job';
  exception when serialization_failure then null;
  end;
  v_evaluation := public.commit_analysis_evaluation(
    v_job, v_token_new, v_target, v_documents, v_payload);
  if v_evaluation is distinct from public.commit_analysis_evaluation(
      v_job, v_token_new, v_target, v_documents, v_payload)
    or (select count(*) from public.evaluations where id = v_evaluation) <> 1
    or (select status from public.analysis_jobs where id = v_job) <> 'completed' then
    raise exception 'Completion was not token-guarded and idempotent';
  end if;

  insert into public.analysis_jobs(source_url_id, analyzer_version, status, created_at)
    values (v_source, 'issue20-v2', 'queued', '2020-01-02T00:00:00Z')
    returning id into v_second_job;
  select * into v_claim from public.claim_analysis_job(v_token_expired, 60, 2);
  if v_claim.job_id is distinct from v_second_job then
    raise exception 'Second job was not claimed';
  end if;
  update public.analysis_jobs set lease_until = now() - interval '1 second'
    where id = v_second_job;
  begin
    perform public.commit_analysis_evaluation(
      v_second_job, v_token_expired, v_target, v_documents, v_payload);
    raise exception 'Expired lease completed a job';
  exception when serialization_failure then null;
  end;
  select * into v_claim from public.claim_analysis_job(v_token_reclaimed, 60, 2);
  if v_claim.job_id is distinct from v_second_job or v_claim.attempts <> 2 then
    raise exception 'Second job did not retry';
  end if;
  update public.analysis_jobs set lease_until = now() - interval '1 second'
    where id = v_second_job;
  perform public.reap_analysis_jobs(2);
  if (select status from public.analysis_jobs where id = v_second_job) <> 'failed'
    or (select worker_token from public.analysis_jobs where id = v_second_job) is not null then
    raise exception 'Retry limit did not fail the expired job';
  end if;

  insert into public.analysis_jobs(source_url_id, analyzer_version, status, created_at)
    values (v_source, 'issue20-v3', 'queued', '2020-01-03T00:00:00Z')
    returning id into v_third_job;
  select * into v_claim from public.claim_analysis_job(v_token_failed, 60, 2);
  v_failed := public.fail_analysis_job(v_third_job, v_token_failed);
  if v_claim.job_id is distinct from v_third_job
    or not v_failed
    or (select status from public.analysis_jobs where id = v_third_job) <> 'failed' then
    raise exception 'Permanent failure did not stop the job';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('anon',
      'public.claim_analysis_job(uuid,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.claim_analysis_job(uuid,integer,integer)', 'EXECUTE')
    or not has_function_privilege('service_role',
      'public.claim_analysis_job(uuid,integer,integer)', 'EXECUTE') then
    raise exception 'Job claim RPC privilege mismatch';
  end if;
end;
$$;
