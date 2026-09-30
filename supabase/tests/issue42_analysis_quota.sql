-- Issue #42: per-user quota for analyses that need a job; cache hits are free.
do $$
declare
  v_user uuid := '42000000-0000-4000-8000-000000000001';
  v_other uuid := '42000000-0000-4000-8000-000000000002';
  v_since timestamptz := now() - interval '1 day';
  v_first record;
  v_repeat record;
  v_fresh record;
  v_target uuid;
  v_evaluation uuid;
  v_document uuid;
begin
  insert into auth.users(id) values (v_user), (v_other);
  insert into public.profiles(id) values (v_user), (v_other);

  select * into v_first from public.request_personal_analysis_limited(
    v_user, 'https://example.org/q42-a', 'https://example.org/q42-a',
    'q42-v1', '2026-09-01T00:00:00Z', v_since, 2);
  perform public.request_personal_analysis_limited(
    v_user, 'https://example.org/q42-b', 'https://example.org/q42-b',
    'q42-v1', '2026-09-01T00:00:00Z', v_since, 2);
  begin
    perform public.request_personal_analysis_limited(
      v_user, 'https://example.org/q42-c', 'https://example.org/q42-c',
      'q42-v1', '2026-09-01T00:00:00Z', v_since, 2);
    raise exception 'third new URL was accepted';
  exception when sqlstate 'P0429' then null;
  end;
  if exists (select 1 from public.source_urls
      where normalized_url = 'https://example.org/q42-c')
    or (select count(*) from public.user_analysis_quota_events
      where user_id = v_user) <> 2 then
    raise exception 'Rejected request left a job, URL or quota event';
  end if;

  -- Re-requesting a URL already counted does not use more quota.
  select * into v_repeat from public.request_personal_analysis_limited(
    v_user, 'https://example.org/q42-a', 'https://example.org/q42-a',
    'q42-v1', '2026-09-01T00:00:00Z', v_since, 2);
  if v_repeat.job_id is distinct from v_first.job_id then
    raise exception 'Repeat request did not join the same job';
  end if;

  -- Another user (for example behind the same IP) has an independent quota.
  perform public.request_personal_analysis_limited(
    v_other, 'https://example.org/q42-c', 'https://example.org/q42-c',
    'q42-v1', '2026-09-01T00:00:00Z', v_since, 2);

  -- A completed URL becomes a fresh cache hit that works while over quota,
  -- and requesting it again cannot free quota for a new URL.
  insert into public.companies(name) values ('Quota Sample');
  insert into public.evaluation_targets(target_type, company_id)
    select 'company', id from public.companies where name = 'Quota Sample'
    returning id into v_target;
  insert into public.evaluations(target_id, axis_catalog_version,
    source_set_hash, rubric_version, evaluator_version, model_version)
  values (v_target, 1, 'q42-hash', 'r1', 'e1', 'm1')
  returning id into v_evaluation;
  insert into public.source_document_versions(source_url_id, content_hash,
    fetched_at, extractor_version)
  values (v_first.source_url_id, 'q42-content', now(), 'v1')
  returning id into v_document;
  insert into public.evaluation_sources(evaluation_id, source_document_version_id)
    values (v_evaluation, v_document);
  update public.analysis_jobs set status = 'completed',
    evaluation_id = v_evaluation, updated_at = now()
  where id = v_first.job_id;

  select * into v_fresh from public.request_personal_analysis_limited(
    v_user, 'https://example.org/q42-a', 'https://example.org/q42-a',
    'q42-v1', '2026-09-01T00:00:00Z', v_since, 2);
  if v_fresh.request_status <> 'fresh' or v_fresh.job_id is not null then
    raise exception 'Cache hit was limited or not fresh';
  end if;
  begin
    perform public.request_personal_analysis_limited(
      v_user, 'https://example.org/q42-d', 'https://example.org/q42-d',
      'q42-v1', '2026-09-01T00:00:00Z', v_since, 2);
    raise exception 'cache hit freed quota for a new URL';
  exception when sqlstate 'P0429' then null;
  end;

  -- Events older than the window no longer count.
  perform public.request_personal_analysis_limited(
    v_user, 'https://example.org/q42-d', 'https://example.org/q42-d',
    'q42-v1', '2026-09-01T00:00:00Z', now() + interval '1 second', 2);

  begin
    perform public.request_personal_analysis_limited(
      v_user, 'https://example.org/q42-e', 'https://example.org/q42-e',
      'q42-v1', '2026-09-01T00:00:00Z', v_since, 0);
    raise exception 'zero limit accepted';
  exception when invalid_parameter_value then null;
  end;

  if has_function_privilege('authenticated',
      'public.request_personal_analysis_limited(uuid,text,text,text,timestamptz,timestamptz,integer)',
      'EXECUTE')
    or not has_function_privilege('service_role',
      'public.request_personal_analysis_limited(uuid,text,text,text,timestamptz,timestamptz,integer)',
      'EXECUTE')
    or has_table_privilege('authenticated',
      'public.user_analysis_quota_events', 'SELECT') then
    raise exception 'Quota objects are exposed to clients';
  end if;
end;
$$;
