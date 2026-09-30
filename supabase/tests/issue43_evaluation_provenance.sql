do $$
declare
  v_source uuid;
  v_company uuid;
  v_target uuid;
  v_job uuid;
  v_token uuid;
  v_first uuid;
  v_second uuid;
  v_documents jsonb;
  v_payload jsonb;
  v_i integer;
  v_facts jsonb := '{"salary":{"status":"known","value":{"minimum":5000000,"maximum":8000000,"currency":"JPY","period":"year"},"excerpt":"年収500万円〜800万円","locator":"p:line-3"},"fullRemote":{"status":"unknown"}}';
begin
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://example.org/issue43', 'https://example.org/issue43')
    returning id into v_source;
  insert into public.companies(name) values ('Issue 43 Company')
    returning id into v_company;
  insert into public.evaluation_targets(target_type, company_id)
    values ('company', v_company) returning id into v_target;
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1,
    'observationStatus', 'unknown', 'anchorValue', null,
    'evaluationMethod', case when axis_key = 'work_location' then 'rule' else 'deterministic' end
  ) order by axis_key) into v_payload
  from public.assessment_axes where axis_version = 1;
  v_payload := jsonb_build_object(
    'axisCatalogVersion', 1, 'sourceSetHash', 'issue43-source-set',
    'rubricVersion', 'public-anchors-v1', 'evaluatorVersion', 'pipeline-v1',
    'modelVersion', 'not-called', 'axisValues', v_payload,
    'evidence', '[]'::jsonb, 'jobFacts', v_facts
  );
  v_documents := jsonb_build_array(jsonb_build_object(
    'sourceUrlId', v_source, 'contentHash', 'issue43-content',
    'fetchedAt', '2026-09-30T00:00:00Z', 'extractorVersion', 'html-v1',
    'extractedText', '[job] 年収500万円〜800万円'
  ));
  for v_i in 1..2 loop
    v_token := pg_catalog.gen_random_uuid();
    insert into public.analysis_jobs(
      source_url_id, analyzer_version, status, attempts, worker_token, lease_until
    ) values (v_source, 'issue43-' || v_i, 'running', 1, v_token,
      now() + interval '5 minutes') returning id into v_job;
    v_second := public.commit_analysis_evaluation_v2(
      v_job, v_token, v_target, v_documents, v_payload);
    if v_i = 1 then v_first := v_second; end if;
  end loop;
  if v_first is distinct from v_second
    or (select evaluation_method from public.evaluated_axis_values
        where evaluation_id = v_first and axis_key = 'work_location') <> 'rule'
    or (select count(*) from public.evaluation_job_facts
        where evaluation_id = v_first) <> 2 then
    raise exception 'Evaluation provenance was not stored or reused';
  end if;
  v_token := pg_catalog.gen_random_uuid();
  insert into public.analysis_jobs(
    source_url_id, analyzer_version, status, attempts, worker_token, lease_until
  ) values (v_source, 'issue43-conflict', 'running', 1, v_token,
    now() + interval '5 minutes') returning id into v_job;
  begin
    perform public.commit_analysis_evaluation_v2(v_job, v_token, v_target,
      v_documents, jsonb_set(v_payload, '{jobFacts,fullRemote}',
        '{"status":"known","value":true,"excerpt":"フルリモート","locator":"p"}'));
    raise exception 'Different facts reused one evaluation';
  exception when sqlstate '22023' then null;
  end;
  if (select status from public.analysis_jobs where id = v_job) <> 'running' then
    raise exception 'Conflict committed the job';
  end if;
end;
$$;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.evaluation_job_facts'::regclass)
    or has_table_privilege('authenticated', 'public.evaluation_job_facts', 'SELECT')
    or has_function_privilege('authenticated',
      'public.commit_analysis_evaluation_v2(uuid,uuid,uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'Evaluation provenance privileges are too broad';
  end if;
end;
$$;
