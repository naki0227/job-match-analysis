do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000001701';
  v_other uuid := '00000000-0000-4000-8000-000000001702';
  v_company uuid := '00000000-0000-4000-8000-000000001703';
  v_job uuid;
  v_target uuid;
  v_company_evaluation uuid;
  v_job_evaluation uuid;
  v_cursor_time timestamptz;
  v_cursor_job uuid;
begin
  insert into auth.users(id) values (v_user), (v_other);
  insert into public.profiles(id) values (v_user), (v_other);
  insert into public.companies(id, name) values (v_company, 'Issue 17 Company');
  insert into public.job_postings(company_id, title)
    select v_company, 'Job ' || n from generate_series(1, 2000) n;
  insert into public.user_saved_jobs(user_id, job_posting_id, created_at)
    select v_user, id, '2026-09-28T00:00:00Z'::timestamptz
      + row_number() over (order by title)::integer * interval '1 second'
    from public.job_postings where company_id = v_company;
  select id into v_job from public.job_postings
    where company_id = v_company order by title desc limit 1;
  insert into public.user_saved_jobs(user_id, job_posting_id)
    values (v_other, v_job);
  insert into public.evaluation_targets(target_type, company_id)
    values ('company', v_company) returning id into v_target;
  insert into public.evaluations(
    target_id, axis_catalog_version, source_set_hash,
    rubric_version, evaluator_version, model_version, created_at
  ) values
    (v_target, 1, 'company-old', 'r1', 'e1', 'm1', '2026-09-01T00:00:00Z'),
    (v_target, 1, 'company-new', 'r1', 'e1', 'm1', '2026-09-02T00:00:00Z');
  select id into v_company_evaluation from public.evaluations
    where target_id = v_target order by created_at desc limit 1;
  insert into public.evaluation_targets(target_type, company_id, job_posting_id)
    values ('job', v_company, v_job) returning id into v_target;
  insert into public.evaluations(
    target_id, axis_catalog_version, source_set_hash,
    rubric_version, evaluator_version, model_version, created_at
  ) values
    (v_target, 1, 'job-old', 'r1', 'e1', 'm1', '2026-09-01T00:00:00Z'),
    (v_target, 1, 'job-new', 'r1', 'e1', 'm1', '2026-09-02T00:00:00Z');
  select id into v_job_evaluation from public.evaluations
    where target_id = v_target order by created_at desc limit 1;

  if (select count(*) from public.list_saved_jobs_page(v_user, 20)) <> 21
    or (select count(*) from public.list_saved_jobs_page(v_user, 100)) <> 101
    or (select count(*) from public.list_saved_jobs_page(v_other, 20)) <> 1 then
    raise exception 'page size or ownership mismatch';
  end if;
  if (select count(*) from public.list_saved_jobs_page(v_user, 100)
      where company_evaluation_id = v_company_evaluation) <> 101 then
    raise exception 'latest company evaluation missing';
  end if;
  if (select job_evaluation_id from public.list_saved_jobs_page(v_user, 100)
      where job_posting_id = v_job) is distinct from v_job_evaluation then
    raise exception 'latest job evaluation missing';
  end if;
  select saved_at, job_posting_id into v_cursor_time, v_cursor_job
    from public.list_saved_jobs_page(v_user, 20)
    offset 19 limit 1;
  if (select count(*) from public.list_saved_jobs_page(
      v_user, 20, v_cursor_time, v_cursor_job)) <> 21
    or exists (
      select 1 from public.list_saved_jobs_page(
        v_user, 20, v_cursor_time, v_cursor_job)
      where (saved_at, job_posting_id) >= (v_cursor_time, v_cursor_job)
    ) then
    raise exception 'cursor pagination overlap';
  end if;
  begin
    perform public.list_saved_jobs_page(v_user, 101);
    raise exception 'invalid limit accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.list_saved_jobs_page(v_user, 20, v_cursor_time, null);
    raise exception 'partial cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end
$$;

do $$
begin
  if has_function_privilege('anon',
    'public.list_saved_jobs_page(uuid,integer,timestamptz,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated',
    'public.list_saved_jobs_page(uuid,integer,timestamptz,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role',
    'public.list_saved_jobs_page(uuid,integer,timestamptz,uuid)', 'EXECUTE') then
    raise exception 'saved jobs RPC privilege mismatch';
  end if;
end
$$;
