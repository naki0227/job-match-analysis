-- Issue #45: history comes from immutable personal Match rows, not manual saves.
do $$
declare
  v_user uuid := '45000000-0000-4000-8000-000000000001';
  v_other uuid := '45000000-0000-4000-8000-000000000002';
  v_company uuid := '45000000-0000-4000-8000-000000000003';
  v_profile_old uuid := '45000000-0000-4000-8000-000000000004';
  v_profile_new uuid := '45000000-0000-4000-8000-000000000005';
  v_profile_other uuid := '45000000-0000-4000-8000-000000000006';
  v_company_target uuid;
  v_company_evaluation_old uuid;
  v_company_evaluation_new uuid;
  v_first_job uuid;
  v_first_target uuid;
  v_first_evaluation_old uuid;
  v_first_evaluation_new uuid;
  v_latest_match uuid;
  v_old_match uuid;
  v_job uuid;
  v_target uuid;
  v_evaluation uuid;
  v_cursor_time timestamptz;
  v_cursor_match uuid;
  n integer;
begin
  insert into auth.users(id) values (v_user), (v_other);
  insert into public.profiles(id) values (v_user), (v_other);
  insert into public.career_profile_versions
    (id, user_id, version, axis_catalog_version, status)
  values
    (v_profile_old, v_user, 1, 1, 'completed'),
    (v_profile_new, v_user, 2, 1, 'completed'),
    (v_profile_other, v_other, 1, 1, 'completed');
  insert into public.companies(id, name) values (v_company, 'Sample Company');
  insert into public.evaluation_targets(target_type, company_id)
    values ('company', v_company) returning id into v_company_target;
  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version, created_at)
  values
    (v_company_target, 1, 'company-old-45', 'r1', 'e1', 'm1',
     '2026-09-01T00:00:00Z') returning id into v_company_evaluation_old;
  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version, created_at)
  values
    (v_company_target, 1, 'company-new-45', 'r1', 'e1', 'm1',
     '2026-09-02T00:00:00Z') returning id into v_company_evaluation_new;

  for n in 1..120 loop
    insert into public.job_postings(company_id, title)
      values (v_company, 'Sample Job ' || n) returning id into v_job;
    insert into public.evaluation_targets(target_type, company_id, job_posting_id)
      values ('job', v_company, v_job) returning id into v_target;
    insert into public.evaluations
      (target_id, axis_catalog_version, source_set_hash,
       rubric_version, evaluator_version, model_version, created_at)
      values (v_target, 1, 'job-45-' || n, 'r1', 'e1', 'm1',
        '2026-09-01T00:00:00Z') returning id into v_evaluation;
    insert into public.match_results
      (user_id, career_profile_version_id, evaluation_id,
       axis_catalog_version, algorithm_version, created_at)
      values (v_user, v_profile_old, v_evaluation, 1, 'a1',
        '2026-09-02T00:00:00Z'::timestamptz + n * interval '1 second');
    if n = 1 then
      v_first_job := v_job;
      v_first_target := v_target;
      v_first_evaluation_old := v_evaluation;
    end if;
  end loop;

  -- A later evaluation and profile version produce a second Match of one job.
  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version, created_at)
  values (v_first_target, 1, 'job-45-revised', 'r1', 'e1', 'm1',
    '2026-09-03T00:00:00Z') returning id into v_first_evaluation_new;
  insert into public.match_results
    (user_id, career_profile_version_id, evaluation_id,
     axis_catalog_version, algorithm_version, created_at)
  values (v_user, v_profile_new, v_first_evaluation_new, 1, 'a1',
    '2026-09-04T00:00:00Z') returning id into v_latest_match;
  select id into v_old_match from public.match_results
    where user_id = v_user and evaluation_id = v_first_evaluation_old;

  -- Another user's Match and a company-only Match must not appear in A's list.
  insert into public.match_results
    (user_id, career_profile_version_id, evaluation_id,
     axis_catalog_version, algorithm_version)
  values
    (v_other, v_profile_other, v_first_evaluation_old, 1, 'a1'),
    (v_user, v_profile_old, v_company_evaluation_old, 1, 'a1');
  insert into public.job_postings(company_id, title)
    values (v_company, 'Not analyzed');

  if (select count(*) from public.list_analysis_history_page(v_user, 20)) <> 21
    or (select count(*) from public.list_analysis_history_page(v_user, 100)) <> 101
    or (select count(*) from public.list_analysis_history_page(v_other, 20)) <> 1
    or (select count(distinct job_posting_id)
        from public.list_analysis_history_page(v_user, 100)) <> 101 then
    raise exception 'History page size, de-duplication, or ownership mismatch';
  end if;
  if (select match_result_id from public.list_analysis_history_page(v_user, 100)
      where job_posting_id = v_first_job) is distinct from v_latest_match
    or (select profile_version from public.list_analysis_history_page(v_user, 100)
      where job_posting_id = v_first_job) <> 2
    or (select job_evaluation_id from public.list_analysis_history_page(v_user, 100)
      where job_posting_id = v_first_job) is distinct from v_first_evaluation_new
    or (select company_evaluation_id from public.list_analysis_history_page(v_user, 100)
      where job_posting_id = v_first_job) is distinct from v_company_evaluation_new
    or (select count(*) from public.match_results
      where id in (v_old_match, v_latest_match)) <> 2 then
    raise exception 'Latest list row or retained historical Match is wrong';
  end if;
  select analyzed_at, match_result_id into v_cursor_time, v_cursor_match
    from public.list_analysis_history_page(v_user, 20)
    offset 19 limit 1;
  if (select count(*) from public.list_analysis_history_page(
      v_user, 20, v_cursor_time, v_cursor_match)) <> 21
    or exists (
      select 1 from public.list_analysis_history_page(
        v_user, 20, v_cursor_time, v_cursor_match)
      where (analyzed_at, match_result_id) >= (v_cursor_time, v_cursor_match)
    ) then
    raise exception 'History cursor overlaps or skips rows';
  end if;
  begin
    perform public.list_analysis_history_page(v_user, 101);
    raise exception 'invalid limit accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.list_analysis_history_page(v_user, 20, v_cursor_time, null);
    raise exception 'partial cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

do $$
begin
  if to_regclass('public.user_saved_jobs') is not null
    or to_regclass('public.match_results_history_page_idx') is null
    or to_regprocedure('public.list_saved_jobs_page(uuid,integer,timestamptz,uuid)') is not null
    or has_function_privilege('anon',
      'public.list_analysis_history_page(uuid,integer,timestamptz,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.list_analysis_history_page(uuid,integer,timestamptz,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role',
      'public.list_analysis_history_page(uuid,integer,timestamptz,uuid)', 'EXECUTE') then
    raise exception 'Legacy table/RPC or history RPC privilege mismatch';
  end if;
end;
$$;
