-- ADR-044: employmentType is an accepted job fact kind; unknown kinds are not.
begin;
do $$
declare
  v_company uuid;
  v_target uuid;
  v_evaluation uuid;
begin
  insert into public.companies(name) values ('Employment Type Co')
    returning id into v_company;
  insert into public.evaluation_targets(target_type, company_id)
    values ('company', v_company) returning id into v_target;
  insert into public.evaluations(target_id, axis_catalog_version, source_set_hash,
    rubric_version, evaluator_version, model_version)
    values (v_target, 1, 'employment-type', 'r', 'e', 'm')
    returning id into v_evaluation;
  insert into public.evaluation_job_facts(evaluation_id, kind, payload)
    values (v_evaluation, 'employmentType', '{"status":"known","value":["FULL_TIME"],"excerpt":"FULL_TIME","locator":"script[type=''application/ld+json'']:JobPosting.employmentType"}');
  begin
    insert into public.evaluation_job_facts(evaluation_id, kind, payload)
      values (v_evaluation, 'favouriteColour', '{"status":"unknown"}');
    raise exception 'unknown fact kind was accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
