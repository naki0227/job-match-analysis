do $$
declare
  v_source uuid;
  v_company uuid;
  v_target uuid;
  v_job uuid;
  v_token uuid;
  v_documents jsonb;
  v_axes jsonb;
  v_payload jsonb;
  v_ids uuid[] := '{}';
  v_i integer;
begin
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://example.org/issue22', 'https://example.org/issue22')
    returning id into v_source;
  insert into public.companies(name) values ('Issue 22 Company')
    returning id into v_company;
  insert into public.evaluation_targets(target_type, company_id)
    values ('company', v_company) returning id into v_target;
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1,
    'observationStatus', 'unknown', 'anchorValue', null
  ) order by axis_key) into v_axes
  from public.assessment_axes where axis_version = 1;
  v_documents := jsonb_build_array(jsonb_build_object(
    'sourceUrlId', v_source, 'contentHash', 'issue22-content',
    'fetchedAt', '2026-09-29T00:00:00Z', 'extractorVersion', 'html-v1',
    'extractedText', '[company] source text'
  ));
  v_payload := jsonb_build_object(
    'axisCatalogVersion', 1, 'sourceSetHash', 'issue22-source-set',
    'rubricVersion', 'public-anchors-v1',
    'evaluatorVersion', 'jev-choice-v1+axis-keywords-v1',
    'modelVersion', 'jev-model-a',
    'axisValues', v_axes, 'evidence', '[]'::jsonb
  );

  for v_i in 1..5 loop
    v_token := pg_catalog.gen_random_uuid();
    insert into public.analysis_jobs(
      source_url_id, analyzer_version, status, attempts,
      worker_token, lease_until
    ) values (
      v_source, 'issue22-' || v_i, 'running', 1,
      v_token, now() + interval '5 minutes'
    ) returning id into v_job;
    if v_i = 3 then
      v_payload := jsonb_set(v_payload, '{modelVersion}', '"jev-model-b"');
    elsif v_i = 4 then
      v_payload := jsonb_set(v_payload, '{modelVersion}', '"jev-model-a"');
      v_payload := jsonb_set(v_payload, '{rubricVersion}', '"public-anchors-v2"');
    elsif v_i = 5 then
      v_payload := jsonb_set(v_payload, '{rubricVersion}', '"public-anchors-v1"');
      v_payload := jsonb_set(v_payload, '{evaluatorVersion}', '"jev-choice-v2"');
    end if;
    v_ids := pg_catalog.array_append(v_ids,
      public.commit_analysis_evaluation(
        v_job, v_token, v_target, v_documents, v_payload));
  end loop;

  if v_ids[1] is distinct from v_ids[2]
    or v_ids[1] = any(v_ids[3:5])
    or v_ids[3] = any(v_ids[4:5])
    or v_ids[4] = v_ids[5]
    or (select count(*) from public.evaluations where target_id = v_target) <> 4
    or (select count(*) from public.evaluated_axis_values
        where evaluation_id = any(v_ids)) <> 32
    or (select count(*) from public.source_document_versions
        where source_url_id = v_source) <> 4
    or (select count(*) from public.analysis_jobs
        where source_url_id = v_source and status = 'completed') <> 5 then
    raise exception 'Evaluation was not reused or separated by its version tuple';
  end if;
end;
$$;
