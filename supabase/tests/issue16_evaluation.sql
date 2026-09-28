do $$
declare
  v_url uuid;
  v_target uuid;
  v_job uuid;
  v_other_job uuid;
  v_conflict_job uuid;
  v_token uuid := '00000000-0000-0000-0000-000000001611';
  v_other_token uuid := '00000000-0000-0000-0000-000000001612';
  v_documents jsonb;
  v_payload jsonb;
  v_axes jsonb;
  v_evaluation uuid;
begin
  insert into public.source_urls(raw_url, normalized_url)
  values ('https://example.org/16', 'https://example.org/16')
  returning id into v_url;
  insert into public.companies(name) values ('Issue 16 Company');
  insert into public.evaluation_targets(target_type, company_id)
  select 'company', id from public.companies where name = 'Issue 16 Company'
  returning id into v_target;
  insert into public.analysis_jobs(
    source_url_id, analyzer_version, status, worker_token
  ) values (v_url, 'issue16-a', 'running', v_token) returning id into v_job;
  insert into public.analysis_jobs(
    source_url_id, analyzer_version, status, worker_token
  ) values (v_url, 'issue16-b', 'running', v_other_token) returning id into v_other_job;
  insert into public.analysis_jobs(
    source_url_id, analyzer_version, status, worker_token
  ) values (v_url, 'issue16-c', 'running',
    '00000000-0000-0000-0000-000000001613') returning id into v_conflict_job;
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1,
    'observationStatus', 'unknown', 'anchorValue', null
  ) order by axis_key) into v_axes
  from public.assessment_axes where axis_version = 1;
  v_documents := jsonb_build_array(jsonb_build_object(
    'sourceUrlId', v_url, 'contentHash', 'hash16',
    'fetchedAt', '2026-09-28T00:00:00Z', 'extractorVersion', 'v1',
    'extractedText', 'source text'
  ));
  v_payload := jsonb_build_object(
    'axisCatalogVersion', 1, 'sourceSetHash', 'set16',
    'rubricVersion', 'r1', 'evaluatorVersion', 'e1', 'modelVersion', 'm1',
    'axisValues', v_axes,
    'evidence', jsonb_build_array(jsonb_build_object(
      'documentIndex', 0, 'axisKey', 'autonomy',
      'excerpt', 'source text', 'locator', 'paragraph 1'
    ))
  );
  begin
    perform public.commit_analysis_evaluation(
      v_job, v_other_token, v_target, v_documents, v_payload);
    raise exception 'wrong token accepted';
  exception when serialization_failure then null;
  end;
  begin
    perform public.commit_analysis_evaluation(
      v_job, v_token, v_target,
      jsonb_set(v_documents, '{0,sourceUrlId}',
        to_jsonb('00000000-0000-0000-0000-000000001699'::text)),
      v_payload);
    raise exception 'missing source URL accepted';
  exception when foreign_key_violation then null;
  end;
  if (select count(*) from public.evaluations where target_id = v_target) <> 0
    or (select status from public.analysis_jobs where id = v_job) <> 'running' then
    raise exception 'failed commit left partial state';
  end if;
  v_evaluation := public.commit_analysis_evaluation(
    v_job, v_token, v_target, v_documents, v_payload);
  if v_evaluation is distinct from public.commit_analysis_evaluation(
    v_job, v_token, v_target, v_documents, v_payload)
    or v_evaluation is distinct from public.commit_analysis_evaluation(
      v_other_job, v_other_token, v_target, v_documents, v_payload) then
    raise exception 'retry or duplicate job did not reuse evaluation';
  end if;
  if (select count(*) from public.evaluations where target_id = v_target) <> 1
    or (select count(*) from public.source_document_versions where source_url_id = v_url) <> 1
    or (select count(*) from public.evaluated_axis_values where evaluation_id = v_evaluation) <> 8
    or (select count(*) from public.evaluation_evidence where evaluation_id = v_evaluation) <> 1
    or (select count(*) from public.analysis_jobs where evaluation_id = v_evaluation
      and status = 'completed') <> 2 then
    raise exception 'evaluation children or job status incomplete';
  end if;
  if v_evaluation is distinct from public.commit_analysis_evaluation(
      v_job, v_token, v_target, v_documents,
      jsonb_set(v_payload, '{evidence,0,excerpt}', '"changed"')) then
    raise exception 'completed retry did not reuse evaluation';
  end if;
  begin
    perform public.commit_analysis_evaluation(
      v_conflict_job, '00000000-0000-0000-0000-000000001613',
      v_target, v_documents,
      jsonb_set(v_payload, '{evidence,0,excerpt}', '"changed"'));
    raise exception 'changed second job accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.analysis_jobs where id = v_conflict_job) <> 'running' then
    raise exception 'payload conflict completed job';
  end if;
end
$$;

do $$
begin
  if has_function_privilege('anon',
    'public.commit_analysis_evaluation(uuid,uuid,uuid,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated',
    'public.commit_analysis_evaluation(uuid,uuid,uuid,jsonb,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role',
    'public.commit_analysis_evaluation(uuid,uuid,uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'evaluation RPC privilege mismatch';
  end if;
  begin
    insert into public.analysis_jobs(
      source_url_id, analyzer_version, status
    ) select id, 'issue16-check', 'completed'
      from public.source_urls where normalized_url = 'https://example.org/16';
    raise exception 'completed without evaluation accepted';
  exception when check_violation then null;
  end;
end
$$;
