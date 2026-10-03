-- ADR-048: duties, requirements and workStyle are accepted job fact kinds
-- holding exact quotes; unknown kinds and malformed payloads are not.
begin;
do $$
declare
  v_company uuid;
  v_target uuid;
  v_evaluation uuid;
begin
  insert into public.companies(name) values ('Job Sections Co')
    returning id into v_company;
  insert into public.evaluation_targets(target_type, company_id)
    values ('company', v_company) returning id into v_target;
  insert into public.evaluations(target_id, axis_catalog_version, source_set_hash,
    rubric_version, evaluator_version, model_version)
    values (v_target, 1, 'job-sections', 'r', 'e', 'm')
    returning id into v_evaluation;
  insert into public.evaluation_job_facts(evaluation_id, kind, payload) values
    (v_evaluation, 'duties', '{"status":"known","value":[{"section":"業務内容","text":"各プロダクトのテックリード業務"}],"excerpt":"各プロダクトのテックリード業務","locator":"li:line-3:fragment-4:part-1"}'),
    (v_evaluation, 'requirements', '{"status":"known","value":[{"section":null,"text":"three years"}],"excerpt":"three years","locator":"p:line-2:fragment-2:part-1","method":"jev"}'),
    (v_evaluation, 'workStyle', '{"status":"unknown"}');
  begin
    insert into public.evaluation_job_facts(evaluation_id, kind, payload)
      values (v_evaluation, 'benefits', '{"status":"unknown"}');
    raise exception 'unknown fact kind was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.evaluation_job_facts(evaluation_id, kind, payload)
      values (v_evaluation, 'duties', '{"status":"unknown","value":[]}');
    raise exception 'unknown section with a value was accepted';
  exception when check_violation then null;
  end;
  if pg_get_functiondef('public.commit_analysis_evaluation_v2(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure)
      not like '%workStyle%' then
    raise exception 'commit_analysis_evaluation_v2 does not accept section facts';
  end if;
end;
$$;
rollback;
