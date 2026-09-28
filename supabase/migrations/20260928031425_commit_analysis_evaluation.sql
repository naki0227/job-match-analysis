-- Issue #16: commit a worker result through one server-only RPC.
alter table public.analysis_jobs add constraint analysis_jobs_completed_evaluation_check
  check (status <> 'completed' or evaluation_id is not null);

create function public.commit_analysis_evaluation(
  p_job_id uuid, p_worker_token uuid, p_target_id uuid,
  p_documents jsonb, p_evaluation jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_token uuid;
  v_job_evaluation_id uuid;
  v_evaluation_id uuid;
  v_catalog integer;
  v_axes jsonb;
  v_evidence jsonb;
  v_document jsonb;
  v_item jsonb;
  v_document_canonical jsonb[] := '{}';
  v_document_ids uuid[] := '{}';
  v_evidence_canonical jsonb[] := '{}';
  v_request jsonb;
  v_stored jsonb;
  v_index integer;
  v_i integer;
begin
  if p_job_id is null or p_worker_token is null or p_target_id is null
    or pg_catalog.jsonb_typeof(p_documents) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_documents) = 0
    or pg_catalog.jsonb_typeof(p_evaluation) is distinct from 'object' then
    raise exception 'invalid_evaluation_request' using errcode = '22023';
  end if;
  v_catalog := (p_evaluation ->> 'axisCatalogVersion')::integer;
  v_axes := p_evaluation -> 'axisValues';
  v_evidence := p_evaluation -> 'evidence';
  if v_catalog is null or v_catalog <= 0
    or pg_catalog.jsonb_typeof(v_axes) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_axes) <> 8
    or pg_catalog.jsonb_typeof(v_evidence) is distinct from 'array' then
    raise exception 'invalid_evaluation_request' using errcode = '22023';
  end if;
  if (select count(*) from public.assessment_axes where axis_version = v_catalog) <> 8 then
    raise exception 'unsupported_axis_catalog' using errcode = '22023';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_axes) loop
    if pg_catalog.jsonb_typeof(v_item -> 'axisKey') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'axisVersion') is distinct from 'number'
      or (v_item ->> 'axisVersion') !~ '^[0-9]+$'
      or pg_catalog.jsonb_typeof(v_item -> 'observationStatus') is distinct from 'string' then
      raise exception 'invalid_axis_value' using errcode = '22023';
    end if;
  end loop;
  for v_document in select value from pg_catalog.jsonb_array_elements(p_documents) loop
    if pg_catalog.jsonb_typeof(v_document -> 'sourceUrlId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_document -> 'contentHash') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_document -> 'fetchedAt') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_document -> 'extractorVersion') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_document -> 'extractedText') not in ('string', 'null') then
      raise exception 'invalid_source_document' using errcode = '22023';
    end if;
    v_document_canonical := pg_catalog.array_append(v_document_canonical,
      pg_catalog.jsonb_build_object(
        'sourceUrlId', (v_document ->> 'sourceUrlId')::uuid,
        'contentHash', v_document ->> 'contentHash',
        'fetchedAt', (v_document ->> 'fetchedAt')::timestamptz,
        'extractorVersion', v_document ->> 'extractorVersion',
        'extractedText', v_document ->> 'extractedText'
      ));
  end loop;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_evidence) loop
    if pg_catalog.jsonb_typeof(v_item -> 'documentIndex') is distinct from 'number'
      or (v_item ->> 'documentIndex') !~ '^[0-9]+$'
      or pg_catalog.jsonb_typeof(v_item -> 'axisKey') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'excerpt') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'locator') not in ('string', 'null') then
      raise exception 'invalid_evidence' using errcode = '22023';
    end if;
    v_index := (v_item ->> 'documentIndex')::integer + 1;
    if v_index < 1 or v_index > pg_catalog.array_length(v_document_canonical, 1) then
      raise exception 'invalid_document_index' using errcode = '22023';
    end if;
    v_evidence_canonical := pg_catalog.array_append(v_evidence_canonical,
      pg_catalog.jsonb_build_object(
        'document', v_document_canonical[v_index],
        'axisKey', v_item ->> 'axisKey',
        'excerpt', v_item ->> 'excerpt',
        'locator', v_item ->> 'locator'
      ));
  end loop;
  v_request := pg_catalog.jsonb_build_object(
    'targetId', p_target_id, 'axisCatalogVersion', v_catalog,
    'sourceSetHash', p_evaluation ->> 'sourceSetHash',
    'rubricVersion', p_evaluation ->> 'rubricVersion',
    'evaluatorVersion', p_evaluation ->> 'evaluatorVersion',
    'modelVersion', p_evaluation ->> 'modelVersion',
    'documents', (select pg_catalog.jsonb_agg(d order by d::text)
      from pg_catalog.unnest(v_document_canonical) as d),
    'axisValues', (select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'axisKey', x."axisKey", 'axisVersion', x."axisVersion",
        'observationStatus', x."observationStatus",
        'anchorValue', x."anchorValue"
      ) order by x."axisKey")
      from pg_catalog.jsonb_to_recordset(v_axes) as x(
        "axisKey" text, "axisVersion" integer,
        "observationStatus" text, "anchorValue" smallint)),
    'evidence', (select coalesce(pg_catalog.jsonb_agg(e order by e::text), '[]'::jsonb)
      from pg_catalog.unnest(v_evidence_canonical) as e)
  );

  select status, worker_token, evaluation_id
    into v_status, v_token, v_job_evaluation_id
  from public.analysis_jobs where id = p_job_id for update;
  if not found or v_token is distinct from p_worker_token
    or v_status not in ('running', 'completed') then
    raise exception 'job_claim_conflict' using errcode = '40001';
  end if;
  -- A completed claim is immutable. Its own retry need not re-read body text,
  -- which the retention worker may have deleted after 30 days.
  if v_status = 'completed' then
    return v_job_evaluation_id;
  end if;
  perform 1 from public.evaluation_targets where id = p_target_id for update;
  if not found then
    raise exception 'evaluation_target_missing' using errcode = '23503';
  end if;
  select id into v_evaluation_id from public.evaluations
  where target_id = p_target_id
    and source_set_hash = p_evaluation ->> 'sourceSetHash'
    and rubric_version = p_evaluation ->> 'rubricVersion'
    and evaluator_version = p_evaluation ->> 'evaluatorVersion'
    and model_version = p_evaluation ->> 'modelVersion';
  if v_evaluation_id is not null then
    select pg_catalog.jsonb_build_object(
      'targetId', ev.target_id, 'axisCatalogVersion', ev.axis_catalog_version,
      'sourceSetHash', ev.source_set_hash, 'rubricVersion', ev.rubric_version,
      'evaluatorVersion', ev.evaluator_version, 'modelVersion', ev.model_version,
      'documents', (
        select pg_catalog.jsonb_agg(d.doc order by d.doc::text)
        from (
          select pg_catalog.jsonb_build_object(
            'sourceUrlId', sd.source_url_id, 'contentHash', sd.content_hash,
            'fetchedAt', sd.fetched_at, 'extractorVersion', sd.extractor_version,
            'extractedText', sd.extracted_text
          ) as doc
          from public.evaluation_sources es
          join public.source_document_versions sd on sd.id = es.source_document_version_id
          where es.evaluation_id = ev.id
        ) d
      ),
      'axisValues', (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'axisKey', a.axis_key, 'axisVersion', a.axis_version,
          'observationStatus', a.observation_status, 'anchorValue', a.anchor_value
        ) order by a.axis_key)
        from public.evaluated_axis_values a where a.evaluation_id = ev.id
      ),
      'evidence', (
        select coalesce(pg_catalog.jsonb_agg(e.item order by e.item::text), '[]'::jsonb)
        from (
          select pg_catalog.jsonb_build_object(
            'document', pg_catalog.jsonb_build_object(
              'sourceUrlId', sd.source_url_id, 'contentHash', sd.content_hash,
              'fetchedAt', sd.fetched_at, 'extractorVersion', sd.extractor_version,
              'extractedText', sd.extracted_text
            ),
            'axisKey', ee.axis_key, 'excerpt', ee.excerpt, 'locator', ee.locator
          ) as item
          from public.evaluation_evidence ee
          join public.source_document_versions sd on sd.id = ee.source_document_version_id
          where ee.evaluation_id = ev.id
        ) e
      )
    ) into v_stored from public.evaluations ev where ev.id = v_evaluation_id;
    if v_stored is distinct from v_request then
      raise exception 'evaluation_payload_conflict' using errcode = '22023';
    end if;
  else
    insert into public.evaluations (
      target_id, axis_catalog_version, source_set_hash,
      rubric_version, evaluator_version, model_version
    ) values (
      p_target_id, v_catalog, p_evaluation ->> 'sourceSetHash',
      p_evaluation ->> 'rubricVersion', p_evaluation ->> 'evaluatorVersion',
      p_evaluation ->> 'modelVersion'
    ) returning id into v_evaluation_id;
    for v_document in select value from pg_catalog.jsonb_array_elements(p_documents) loop
      insert into public.source_document_versions (
        source_url_id, content_hash, fetched_at, extractor_version, extracted_text
      ) values (
        (v_document ->> 'sourceUrlId')::uuid, v_document ->> 'contentHash',
        (v_document ->> 'fetchedAt')::timestamptz,
        v_document ->> 'extractorVersion', v_document ->> 'extractedText'
      ) returning id into v_job_evaluation_id;
      v_document_ids := pg_catalog.array_append(v_document_ids, v_job_evaluation_id);
      insert into public.evaluation_sources(evaluation_id, source_document_version_id)
        values (v_evaluation_id, v_job_evaluation_id);
    end loop;
    insert into public.evaluated_axis_values (
      evaluation_id, axis_key, axis_version, observation_status, anchor_value
    )
    select v_evaluation_id, x."axisKey", x."axisVersion",
      x."observationStatus", x."anchorValue"
    from pg_catalog.jsonb_to_recordset(v_axes) as x(
      "axisKey" text, "axisVersion" integer,
      "observationStatus" text, "anchorValue" smallint
    );
    for v_item in select value from pg_catalog.jsonb_array_elements(v_evidence) loop
      v_i := (v_item ->> 'documentIndex')::integer + 1;
      insert into public.evaluation_evidence (
        evaluation_id, axis_key, source_document_version_id, excerpt, locator
      ) values (
        v_evaluation_id, v_item ->> 'axisKey', v_document_ids[v_i],
        v_item ->> 'excerpt', v_item ->> 'locator'
      );
    end loop;
  end if;
  update public.analysis_jobs
    set status = 'completed', evaluation_id = v_evaluation_id, updated_at = now()
    where id = p_job_id and status = 'running';
  return v_evaluation_id;
end;
$$;

revoke all on function public.commit_analysis_evaluation(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_analysis_evaluation(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;
