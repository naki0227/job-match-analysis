-- Match API RPCs: atomic idempotent commit, snapshot integrity, owner-only reads.
do $$
declare
  v_user uuid := '32000000-0000-4000-8000-000000000001';
  v_other uuid := '32000000-0000-4000-8000-000000000002';
  v_profile uuid := '32000000-0000-4000-8000-000000000003';
  v_other_profile uuid := '32000000-0000-4000-8000-000000000004';
  v_company uuid := '32000000-0000-4000-8000-000000000005';
  v_job uuid;
  v_job_target uuid;
  v_company_target uuid;
  v_url uuid;
  v_document uuid;
  v_evaluation uuid;
  v_company_old uuid;
  v_company_new uuid;
  v_keys text[] := array['work_location', 'autonomy', 'collaboration',
    'growth_direction', 'work_change', 'schedule_flexibility',
    'role_breadth', 'customer_contact'];
  v_axes jsonb;
  v_constraints jsonb := '[
    {"kind":"min_salary","status":"unknown","reason":"missing_information"},
    {"kind":"location","status":"not_required","reason":null},
    {"kind":"full_remote","status":"not_required","reason":null}
  ]';
  v_read jsonb;
  v_first record;
  v_second record;
begin
  insert into auth.users(id) values (v_user), (v_other);
  insert into public.profiles(id) values (v_user), (v_other);
  insert into public.career_profile_versions
    (id, user_id, version, axis_catalog_version, status)
  values (v_profile, v_user, 1, 1, 'completed'),
    (v_other_profile, v_other, 1, 1, 'completed');
  insert into public.career_profile_axis_values
    (profile_version_id, axis_key, axis_version, preference, importance)
  select p, k, 1, 50, case when k = 'work_change' then 0 else 50 end
  from unnest(v_keys) k, unnest(array[v_profile, v_other_profile]) p;

  insert into public.companies(id, name) values (v_company, 'Sample Match Co');
  insert into public.job_postings(company_id, title)
    values (v_company, 'Sample Engineer') returning id into v_job;
  insert into public.evaluation_targets(target_type, company_id, job_posting_id)
    values ('job', v_company, v_job) returning id into v_job_target;
  insert into public.evaluation_targets(target_type, company_id)
    values ('company', v_company) returning id into v_company_target;
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://jobs.example.org/match?utm_source=x',
      'https://jobs.example.org/match') returning id into v_url;
  insert into public.source_document_versions
    (source_url_id, content_hash, fetched_at, extractor_version)
  values (v_url, 'hash-match', '2026-09-20T01:02:03Z', 'x1')
  returning id into v_document;

  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version)
  values (v_job_target, 1, 'match-job', 'r1', 'e1', 'm1')
  returning id into v_evaluation;
  insert into public.evaluation_sources(evaluation_id, source_document_version_id)
    values (v_evaluation, v_document);
  insert into public.evaluated_axis_values
    (evaluation_id, axis_key, axis_version, observation_status, anchor_value)
  values (v_evaluation, 'work_location', 1, 'known', 50),
    (v_evaluation, 'autonomy', 1, 'unknown', null);
  insert into public.evaluation_evidence
    (evaluation_id, axis_key, source_document_version_id, excerpt)
  values (v_evaluation, 'work_location', v_document, '週3日オフィス勤務');

  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version, created_at)
  values (v_company_target, 1, 'match-company-old', 'r1', 'e1', 'm1',
    '2026-09-01T00:00:00Z') returning id into v_company_old;
  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version, created_at)
  values (v_company_target, 1, 'match-company-new', 'r1', 'e1', 'm1',
    '2026-09-02T00:00:00Z') returning id into v_company_new;

  -- Shared read: target names, evidence source, latest company evaluation.
  v_read := public.read_evaluation_for_match(v_evaluation);
  if v_read ->> 'targetType' <> 'job'
    or v_read ->> 'companyName' <> 'Sample Match Co'
    or v_read ->> 'jobTitle' <> 'Sample Engineer'
    or jsonb_array_length(v_read -> 'evaluation' -> 'axisValues') <> 2
    or v_read -> 'evaluation' -> 'evidence' -> 0 ->> 'sourceUrl'
      <> 'https://jobs.example.org/match'
    or (v_read -> 'evaluation' -> 'evidence' -> 0 ->> 'fetchedAt')::timestamptz
      <> '2026-09-20T01:02:03Z'
    or (v_read -> 'companyEvaluation' ->> 'evaluationId')::uuid <> v_company_new
    or public.read_evaluation_for_match(gen_random_uuid()) is not null
    or public.read_evaluation_for_match(v_company_old) ->> 'targetType' <> 'company' then
    raise exception 'Evaluation read for Match is wrong: %', v_read;
  end if;

  select jsonb_agg(jsonb_build_object(
    'axisKey', k,
    'preference', 50,
    'importance', case when k = 'work_change' then 0 else 50 end,
    'observationStatus', case when k = 'work_location' then 'known' else 'unknown' end,
    'observedAnchor', case when k = 'work_location' then 50 end,
    'comparisonStatus', case
      when k = 'work_change' then 'excluded'
      when k = 'work_location' then 'close'
      else 'unknown' end,
    'difference', case when k = 'work_location' then 0 end
  )) into v_axes from unnest(v_keys) k;

  select * into v_first from public.commit_match_result(
    v_user, v_profile, v_evaluation, 'match-engine-v1', v_axes, v_constraints);
  select * into v_second from public.commit_match_result(
    v_user, v_profile, v_evaluation, 'match-engine-v1', v_axes, v_constraints);
  if not v_first.created or v_second.created
    or v_first.match_result_id <> v_second.match_result_id
    or (select count(*) from public.match_results where user_id = v_user) <> 1
    or (select count(*) from public.match_axis_results
      where match_result_id = v_first.match_result_id) <> 8
    or (select count(*) from public.match_constraint_results
      where match_result_id = v_first.match_result_id) <> 3 then
    raise exception 'Match commit is not atomic and idempotent';
  end if;

  -- Rejected inputs never leave a partial Match behind.
  begin
    perform public.commit_match_result(v_user, v_profile, v_evaluation,
      'match-engine-v2', jsonb_set(v_axes, '{0,preference}', '99'), v_constraints);
    raise exception 'snapshot mismatch accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.commit_match_result(v_user, v_other_profile, v_evaluation,
      'match-engine-v1', v_axes, v_constraints);
    raise exception 'another user profile accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.commit_match_result(v_user, v_profile, v_company_new,
      'match-engine-v1', v_axes, v_constraints);
    raise exception 'company evaluation accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.commit_match_result(v_user, v_profile, v_evaluation,
      'match-engine-v1', v_axes - 0, v_constraints);
    raise exception 'seven axes accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.commit_match_result(v_user, v_profile, v_evaluation,
      'match-engine-v3', v_axes,
      jsonb_set(v_constraints, '{0}', '{"kind":"min_salary","status":"unmet","reason":null}'));
    raise exception 'unmet constraint without reason accepted';
  exception when check_violation then null;
  end;
  if (select count(*) from public.match_results where user_id = v_user) <> 1 then
    raise exception 'Rejected Match left rows behind';
  end if;

  v_read := public.read_match_result(v_user, v_first.match_result_id);
  if (v_read ->> 'profileVersion')::integer <> 1
    or (v_read ->> 'evaluationId')::uuid <> v_evaluation
    or jsonb_array_length(v_read -> 'axes') <> 8
    or v_read -> 'constraints' -> 0 ->> 'kind' <> 'min_salary'
    or v_read -> 'constraints' -> 2 ->> 'kind' <> 'full_remote'
    or public.read_match_result(v_other, v_first.match_result_id) is not null then
    raise exception 'Match read is wrong or not owner-only: %', v_read;
  end if;
end;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.evaluation_match_snapshot(uuid)',
    'public.read_evaluation_for_match(uuid)',
    'public.commit_match_result(uuid,uuid,uuid,text,jsonb,jsonb)',
    'public.read_match_result(uuid,uuid)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Match RPC privilege mismatch: %', v_function;
    end if;
  end loop;
end;
$$;
