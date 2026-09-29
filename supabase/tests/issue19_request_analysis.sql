do $$
declare
  v_first record;
  v_repeat record;
  v_fresh record;
  v_stale record;
  v_target uuid;
  v_evaluation uuid;
  v_document uuid;
  v_older_evaluation uuid;
  v_older_document uuid;
begin
  select * into v_first from public.request_analysis(
    'https://example.org/issue19?utm_source=test',
    'https://example.org/issue19', 'issue19-v1',
    '2026-09-27T00:00:00Z');
  select * into v_repeat from public.request_analysis(
    'https://example.org/issue19#fragment',
    'https://example.org/issue19', 'issue19-v1',
    '2026-09-27T00:00:00Z');
  if v_first.request_status <> 'queued'
    or v_first.job_id is null
    or v_first.job_id is distinct from v_repeat.job_id
    or v_first.source_url_id is distinct from v_repeat.source_url_id
    or (select count(*) from public.source_urls
        where normalized_url = 'https://example.org/issue19') <> 1
    or (select raw_url from public.source_urls where id = v_first.source_url_id)
      <> 'https://example.org/issue19?utm_source=test' then
    raise exception 'URL upsert, raw provenance, or active-job reuse failed';
  end if;

  insert into public.companies(name) values ('Issue 19 Sample');
  insert into public.evaluation_targets(target_type, company_id)
    select 'company', id from public.companies where name = 'Issue 19 Sample'
    returning id into v_target;
  insert into public.evaluations(
    target_id, axis_catalog_version, source_set_hash,
    rubric_version, evaluator_version, model_version
  ) values (v_target, 1, 'issue19-hash', 'r1', 'e1', 'm1')
    returning id into v_evaluation;
  insert into public.source_document_versions(
    source_url_id, content_hash, fetched_at, extractor_version, extracted_text
  ) values (
    v_first.source_url_id, 'issue19-content', '2026-09-28T00:00:00Z',
    'v1', 'sample document'
  ) returning id into v_document;
  insert into public.evaluation_sources(evaluation_id, source_document_version_id)
    values (v_evaluation, v_document);
  update public.analysis_jobs
    set status = 'completed', evaluation_id = v_evaluation, updated_at = now()
    where id = v_first.job_id;

  select * into v_fresh from public.request_analysis(
    'https://example.org/issue19', 'https://example.org/issue19',
    'issue19-v1', '2026-09-27T00:00:00Z');
  if v_fresh.request_status <> 'fresh' or v_fresh.job_id is not null
    or v_fresh.evaluation_id is distinct from v_evaluation
    or (select count(*) from public.analysis_jobs
      where source_url_id = v_first.source_url_id) <> 1 then
    raise exception 'Fresh evaluation created an unnecessary job';
  end if;

  select * into v_stale from public.request_analysis(
    'https://example.org/issue19', 'https://example.org/issue19',
    'issue19-v1', '2026-09-29T00:00:00Z');
  if v_stale.request_status <> 'stale' or v_stale.job_id is null
    or v_stale.evaluation_id is distinct from v_evaluation
    or v_stale.job_id = v_first.job_id
    or (select count(*) from public.analysis_jobs
      where source_url_id = v_first.source_url_id) <> 2 then
    raise exception 'Stale evaluation did not schedule one refresh';
  end if;
  select * into v_repeat from public.request_analysis(
    'https://example.org/issue19', 'https://example.org/issue19',
    'issue19-v1', '2026-09-29T00:00:00Z');
  if v_repeat.job_id is distinct from v_stale.job_id then
    raise exception 'Stale refresh was not shared';
  end if;

  -- A later completion can carry an older source snapshot. Keep reusing an
  -- available fresh evaluation instead of scheduling a third job.
  insert into public.evaluations(
    target_id, axis_catalog_version, source_set_hash,
    rubric_version, evaluator_version, model_version
  ) values (v_target, 1, 'issue19-older-hash', 'r1', 'e1', 'm1')
    returning id into v_older_evaluation;
  insert into public.source_document_versions(
    source_url_id, content_hash, fetched_at, extractor_version, extracted_text
  ) values (
    v_first.source_url_id, 'issue19-older-content', '2026-09-26T00:00:00Z',
    'v1', 'older document'
  ) returning id into v_older_document;
  insert into public.evaluation_sources(evaluation_id, source_document_version_id)
    values (v_older_evaluation, v_older_document);
  update public.analysis_jobs
    set status = 'completed', evaluation_id = v_older_evaluation,
      updated_at = now() + interval '1 second'
    where id = v_stale.job_id;
  select * into v_fresh from public.request_analysis(
    'https://example.org/issue19', 'https://example.org/issue19',
    'issue19-v1', '2026-09-27T00:00:00Z');
  if v_fresh.request_status <> 'fresh'
    or v_fresh.evaluation_id is distinct from v_evaluation
    or (select count(*) from public.analysis_jobs
      where source_url_id = v_first.source_url_id) <> 2 then
    raise exception 'Existing fresh evaluation was shadowed by stale completion';
  end if;

  begin
    perform public.request_analysis('not a URL', 'http://internal', 'v1', now());
    raise exception 'invalid normalized URL accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

do $$
begin
  if has_function_privilege('anon',
    'public.request_analysis(text,text,text,timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated',
    'public.request_analysis(text,text,text,timestamptz)', 'EXECUTE')
    or not has_function_privilege('service_role',
    'public.request_analysis(text,text,text,timestamptz)', 'EXECUTE')
    or to_regclass('public.analysis_jobs_completed_lookup_idx') is null then
    raise exception 'Request RPC privilege or index mismatch';
  end if;
end;
$$;
