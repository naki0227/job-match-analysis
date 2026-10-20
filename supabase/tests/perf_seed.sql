-- Issue #30: data for the API performance run (scripts/test-api-perf.sh).
-- Four users have 1, 20, 100 and 1000 analysed jobs, so a history page can
-- be timed against a growing history. Every Match carries its 8 axis rows
-- and 3 constraint rows, like one written by commit_match_result.
-- One more job evaluation, never matched, is compared by POST /v1/matches.
do $$
declare
  v_company uuid := '30000000-0000-4000-8000-000000000100';
  v_counts integer[] := array[1, 20, 100, 1000];
  v_user uuid;
  v_profile uuid;
  v_job uuid;
  v_target uuid;
  v_evaluation uuid;
  v_match uuid;
  i integer;
  n integer;
begin
  insert into public.companies(id, name) values (v_company, 'Sample Perf Co');

  for i in 1..array_length(v_counts, 1) loop
    v_user := ('30000000-0000-4000-8000-00000000000' || i)::uuid;
    v_profile := ('30000000-0000-4000-8000-00000000001' || i)::uuid;
    insert into auth.users(id) values (v_user);
    insert into public.profiles(id) values (v_user);
    insert into public.career_profile_versions
      (id, user_id, version, axis_catalog_version, status)
      values (v_profile, v_user, 1, 1, 'completed');
    insert into public.career_profile_axis_values
      (profile_version_id, axis_key, axis_version, preference, importance)
      select v_profile, a.axis_key, 1, 50, 50 from public.assessment_axes a;
    insert into public.career_constraints(profile_version_id, full_remote_required)
      values (v_profile, false);

    for n in 1..v_counts[i] loop
      insert into public.job_postings(company_id, title)
        values (v_company, 'Sample Perf Job ' || n) returning id into v_job;
      insert into public.evaluation_targets(target_type, company_id, job_posting_id)
        values ('job', v_company, v_job) returning id into v_target;
      insert into public.evaluations
        (target_id, axis_catalog_version, source_set_hash,
         rubric_version, evaluator_version, model_version, created_at)
        values (v_target, 1, 'perf-' || i || '-' || n, 'r1', 'e1', 'm1',
          '2026-10-01T00:00:00Z'::timestamptz + n * interval '1 minute')
        returning id into v_evaluation;
      -- Six axes match the profile, one differs, one is unknown.
      insert into public.evaluated_axis_values
        (evaluation_id, axis_key, axis_version, observation_status, anchor_value)
        select v_evaluation, a.axis_key, 1,
          case when a.axis_key = 'work_change' then 'unknown' else 'known' end,
          case a.axis_key when 'work_change' then null
            when 'role_breadth' then 100 else 50 end
        from public.assessment_axes a;
      insert into public.match_results
        (user_id, career_profile_version_id, evaluation_id,
         axis_catalog_version, algorithm_version, created_at)
        values (v_user, v_profile, v_evaluation, 1, 'match-engine-v3',
          '2026-10-02T00:00:00Z'::timestamptz + n * interval '1 minute')
        returning id into v_match;
      insert into public.match_axis_results
        (match_result_id, axis_key, axis_version, preference, importance,
         observation_status, observed_anchor, comparison_status, difference)
        select v_match, a.axis_key, 1, 50, 50,
          case when a.axis_key = 'work_change' then 'unknown' else 'known' end,
          case a.axis_key when 'work_change' then null
            when 'role_breadth' then 100 else 50 end,
          case a.axis_key when 'work_change' then 'unknown'
            when 'role_breadth' then 'different' else 'close' end,
          case a.axis_key when 'work_change' then null
            when 'role_breadth' then 50 else 0 end
        from public.assessment_axes a;
      insert into public.match_constraint_results(match_result_id, kind, status)
        values (v_match, 'min_salary', 'not_required'),
          (v_match, 'location', 'not_required'),
          (v_match, 'full_remote', 'not_required');
    end loop;
  end loop;

  -- The job compared by POST /v1/matches.
  insert into public.job_postings(id, company_id, title)
    values ('30000000-0000-4000-8000-000000000201', v_company, 'Sample Perf Match Job');
  insert into public.evaluation_targets(target_type, company_id, job_posting_id)
    values ('job', v_company, '30000000-0000-4000-8000-000000000201')
    returning id into v_target;
  insert into public.evaluations
    (id, target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version)
    values ('30000000-0000-4000-8000-000000000202', v_target, 1,
      'perf-match', 'r1', 'e1', 'm1');
  insert into public.evaluated_axis_values
    (evaluation_id, axis_key, axis_version, observation_status, anchor_value)
    select '30000000-0000-4000-8000-000000000202', a.axis_key, 1, 'known', 50
    from public.assessment_axes a;
  insert into public.evaluation_job_facts(evaluation_id, kind, payload)
    values ('30000000-0000-4000-8000-000000000202', 'location',
      '{"status":"known","value":["東京都"]}'),
    ('30000000-0000-4000-8000-000000000202', 'duties',
      '{"status":"known","value":[{"section":"仕事内容","text":"サンプルの業務です。"}]}');
end
$$;

-- A fresh shared result of one URL, so POST /v1/analyses is a cache hit.
insert into public.source_urls(id, raw_url, normalized_url)
  values ('30000000-0000-4000-8000-000000000301',
    'https://jobs.example.com/perf/cached', 'https://jobs.example.com/perf/cached');
insert into public.source_document_versions
  (id, source_url_id, content_hash, fetched_at, extractor_version)
  values ('30000000-0000-4000-8000-000000000302',
    '30000000-0000-4000-8000-000000000301', 'perf-hash', now(), 'x1');
insert into public.evaluation_sources(evaluation_id, source_document_version_id)
  values ('30000000-0000-4000-8000-000000000202',
    '30000000-0000-4000-8000-000000000302');
insert into public.analysis_jobs(source_url_id, analyzer_version, status, evaluation_id)
  values ('30000000-0000-4000-8000-000000000301', 'perf-v1', 'completed',
    '30000000-0000-4000-8000-000000000202');
