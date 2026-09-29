do $$
declare
  v_owner uuid := '32000000-0000-4000-8000-000000000001';
  v_other uuid := '32000000-0000-4000-8000-000000000002';
  v_first record;
  v_second record;
  v_evaluation uuid;
begin
  select * into v_first from public.request_personal_analysis(
    v_owner, 'https://example.org/issue27-personal?utm_source=test',
    'https://example.org/issue27-personal', 'issue27-v1',
    '2026-09-29T00:00:00Z');
  select * into v_second from public.request_personal_analysis(
    v_other, 'https://example.org/issue27-personal',
    'https://example.org/issue27-personal', 'issue27-v1',
    '2026-09-29T00:00:00Z');
  if v_first.job_id is distinct from v_second.job_id
    or (select count(*) from public.user_analysis_requests
      where source_url_id = v_first.source_url_id) <> 2 then
    raise exception 'Personal interests did not share the job';
  end if;
  select id into v_evaluation from public.evaluations
    where source_set_hash = 'match-job';
  update public.analysis_jobs set status = 'completed', evaluation_id = v_evaluation
    where id = v_first.job_id;
  if (select count(*) from public.list_unmatched_analysis_evaluations(v_owner, 20)) <> 0
    or (select count(*) from public.list_unmatched_analysis_evaluations(v_other, 20)) <> 1
    or (select evaluation_id from public.list_unmatched_analysis_evaluations(v_other, 20))
      is distinct from v_evaluation then
    raise exception 'Pending evaluation did not respect owner or existing Match';
  end if;
  if has_table_privilege('authenticated', 'public.user_analysis_requests', 'SELECT')
    or has_function_privilege('authenticated',
      'public.request_personal_analysis(uuid,text,text,text,timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.list_unmatched_analysis_evaluations(uuid,integer)', 'EXECUTE') then
    raise exception 'Personal analysis intent leaked to authenticated role';
  end if;
end $$;
