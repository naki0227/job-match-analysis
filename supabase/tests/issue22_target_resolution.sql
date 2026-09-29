do $$
declare
  v_source uuid;
  v_job uuid;
  v_token uuid := pg_catalog.gen_random_uuid();
  v_target uuid;
  v_again uuid;
  v_changed uuid;
begin
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://example.org/issue22-target', 'https://example.org/issue22-target')
    returning id into v_source;
  insert into public.analysis_jobs(
    source_url_id, analyzer_version, status, attempts, worker_token, lease_until
  ) values (
    v_source, 'issue22-target-v1', 'running', 1, v_token,
    now() + interval '5 minutes'
  ) returning id into v_job;

  v_target := public.resolve_job_evaluation_target(
    v_job, v_token, 'Engineer', 'Example Inc');
  v_again := public.resolve_job_evaluation_target(
    v_job, v_token, 'Engineer', 'Example Inc');
  v_changed := public.resolve_job_evaluation_target(
    v_job, v_token, 'Designer', 'Example Inc');
  if v_target is distinct from v_again or v_target = v_changed
    or (select count(*) from public.job_postings
        where source_url_id = v_source) <> 2
    or (select count(*) from public.evaluation_targets
        where id in (v_target, v_changed) and target_type = 'job') <> 2 then
    raise exception 'Job target was not reused or changed correctly';
  end if;

  begin
    perform public.resolve_job_evaluation_target(
      v_job, pg_catalog.gen_random_uuid(), 'Engineer', 'Example Inc');
    raise exception 'Wrong worker token was accepted';
  exception when serialization_failure then null;
  end;
  update public.analysis_jobs set lease_until = now() - interval '1 second'
    where id = v_job;
  begin
    perform public.resolve_job_evaluation_target(
      v_job, v_token, 'Engineer', 'Example Inc');
    raise exception 'Expired lease was accepted';
  exception when serialization_failure then null;
  end;
  if pg_catalog.has_function_privilege(
      'authenticated',
      'public.resolve_job_evaluation_target(uuid,uuid,text,text)', 'execute')
    or pg_catalog.has_function_privilege(
      'anon',
      'public.resolve_job_evaluation_target(uuid,uuid,text,text)', 'execute') then
    raise exception 'Target resolution is executable by a browser role';
  end if;
  delete from public.analysis_jobs where id = v_job;
end;
$$;
