-- ADR-049: an axis the posting supports between two adjacent anchors is a
-- range observation (anchor_value = lower anchor, anchor_max = upper), and a
-- Match compares it by both ends: close, different, or partial.
--
-- Additive: new nullable columns, wider CHECKs and the same functions
-- reading/writing the new columns. Existing rows keep NULL in the new
-- columns and still satisfy every check; stored evaluation payloads compare
-- equal because a missing anchorMax is NULL on both sides.
--
-- Rollback: supabase/rollback/20261002104119_axis_range_observation.sql (turns range
-- observations into unknown and partial comparisons into unknown first).
begin;

alter table public.evaluated_axis_values add column anchor_max smallint;
alter table public.evaluated_axis_values
  drop constraint evaluated_axis_values_observation_status_check,
  drop constraint evaluated_axis_values_check;
alter table public.evaluated_axis_values
  add constraint evaluated_axis_values_observation_status_check check (
    observation_status in ('known', 'unknown', 'conflicting', 'stale', 'range')
  ),
  add constraint evaluated_axis_values_check check (
    (observation_status in ('known', 'stale')
      and anchor_value is not null and anchor_value in (0, 50, 100)
      and anchor_max is null)
    or (observation_status in ('unknown', 'conflicting')
      and anchor_value is null and anchor_max is null)
    or (observation_status = 'range'
      and anchor_value is not null and anchor_max is not null
      and anchor_value in (0, 50) and anchor_max = anchor_value + 50)
  );

alter table public.match_axis_results
  add column observed_anchor_max smallint,
  add column difference_max smallint check (difference_max between 0 and 100);
alter table public.match_axis_results
  drop constraint match_axis_results_observation_status_check,
  drop constraint match_axis_results_comparison_status_check,
  drop constraint match_axis_results_check,
  drop constraint match_axis_results_check1;
alter table public.match_axis_results
  add constraint match_axis_results_observation_status_check check (
    observation_status in ('known', 'unknown', 'conflicting', 'stale', 'range')
  ),
  add constraint match_axis_results_comparison_status_check check (
    comparison_status in (
      'close', 'different', 'partial', 'excluded', 'unknown', 'conflicting', 'stale'
    )
  ),
  add constraint match_axis_results_check check (
    (observation_status in ('known', 'stale')
      and observed_anchor is not null and observed_anchor in (0, 50, 100)
      and observed_anchor_max is null)
    or (observation_status in ('unknown', 'conflicting')
      and observed_anchor is null and observed_anchor_max is null)
    or (observation_status = 'range'
      and observed_anchor is not null and observed_anchor_max is not null
      and observed_anchor in (0, 50) and observed_anchor_max = observed_anchor + 50)
  ),
  -- difference is the smallest possible difference, difference_max the
  -- largest (range only). close/different/partial follow from both ends.
  add constraint match_axis_results_check1 check (
    (observation_status = 'known' and difference_max is null and (
      (comparison_status = 'close' and importance > 0 and difference is not null
        and difference = abs(preference - observed_anchor) and difference <= 25)
      or (comparison_status = 'different' and importance > 0
        and difference is not null
        and difference = abs(preference - observed_anchor) and difference > 25)))
    or (observation_status = 'range' and importance > 0
      and observed_anchor is not null and observed_anchor_max is not null
      and difference is not null and difference_max is not null
      and difference = case
        when preference between observed_anchor and observed_anchor_max then 0
        else least(abs(preference - observed_anchor),
          abs(preference - observed_anchor_max)) end
      and difference_max = greatest(abs(preference - observed_anchor),
        abs(preference - observed_anchor_max))
      and comparison_status = case
        when difference_max <= 25 then 'close'
        when difference > 25 then 'different'
        else 'partial' end)
    or (comparison_status = 'excluded' and importance = 0
      and difference is null and difference_max is null)
    or (comparison_status in ('unknown', 'conflicting', 'stale')
      and comparison_status = observation_status and importance > 0
      and difference is null and difference_max is null)
  );

-- Same functions as 20260928031425 and 20260929093000, carrying anchor_max,
-- observed_anchor_max and difference_max. Grants and ownership are kept by
-- CREATE OR REPLACE.
create or replace function public.commit_analysis_evaluation(
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
        'anchorValue', x."anchorValue",
        'anchorMax', x."anchorMax"
      ) order by x."axisKey")
      from pg_catalog.jsonb_to_recordset(v_axes) as x(
        "axisKey" text, "axisVersion" integer,
        "observationStatus" text, "anchorValue" smallint,
        "anchorMax" smallint)),
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
          'observationStatus', a.observation_status, 'anchorValue', a.anchor_value,
          'anchorMax', a.anchor_max
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
      evaluation_id, axis_key, axis_version, observation_status, anchor_value,
      anchor_max
    )
    select v_evaluation_id, x."axisKey", x."axisVersion",
      x."observationStatus", x."anchorValue", x."anchorMax"
    from pg_catalog.jsonb_to_recordset(v_axes) as x(
      "axisKey" text, "axisVersion" integer,
      "observationStatus" text, "anchorValue" smallint, "anchorMax" smallint
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

create or replace function public.evaluation_match_snapshot(p_evaluation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'evaluationId', e.id,
    'evaluatedAt', e.created_at,
    'axisCatalogVersion', e.axis_catalog_version,
    'axisValues', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'axisKey', v.axis_key,
        'axisVersion', v.axis_version,
        'observationStatus', v.observation_status,
        'anchorValue', v.anchor_value,
        'anchorMax', v.anchor_max
      ) order by v.axis_key)
      from public.evaluated_axis_values v
      where v.evaluation_id = e.id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'axisKey', ev.axis_key,
        'quote', ev.excerpt,
        'sourceUrl', s.normalized_url,
        'fetchedAt', d.fetched_at
      ) order by ev.axis_key, d.fetched_at, ev.id)
      from public.evaluation_evidence ev
      join public.source_document_versions d
        on d.id = ev.source_document_version_id
      join public.source_urls s on s.id = d.source_url_id
      where ev.evaluation_id = e.id
    ), '[]'::jsonb)
  )
  from public.evaluations e
  where e.id = p_evaluation_id;
$$;

create or replace function public.commit_match_result(
  p_user_id uuid,
  p_profile_version_id uuid,
  p_evaluation_id uuid,
  p_algorithm_version text,
  p_axes jsonb,
  p_constraints jsonb
)
returns table (match_result_id uuid, created_at timestamptz, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_catalog integer;
  v_id uuid;
  v_created_at timestamptz;
begin
  if p_user_id is null or p_profile_version_id is null
    or p_evaluation_id is null or p_algorithm_version is null
    or length(btrim(p_algorithm_version)) = 0
    or pg_catalog.jsonb_typeof(p_axes) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_axes) <> 8
    or pg_catalog.jsonb_typeof(p_constraints) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_constraints) <> 3 then
    raise exception 'invalid_match_result' using errcode = '22023';
  end if;

  select v.axis_catalog_version into v_catalog
  from public.career_profile_versions v
  where v.id = p_profile_version_id and v.user_id = p_user_id
    and v.status = 'completed';
  if v_catalog is null then
    raise exception 'profile_version_not_owned' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.evaluations e
    join public.evaluation_targets t on t.id = e.target_id
    where e.id = p_evaluation_id and t.target_type = 'job'
      and e.axis_catalog_version = v_catalog
  ) then
    raise exception 'job_evaluation_required' using errcode = '22023';
  end if;

  -- The snapshot must repeat the stored profile answers and evaluation facts.
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_axes) as x(
      "axisKey" text, preference smallint, importance smallint,
      "observationStatus" text, "observedAnchor" smallint,
      "observedAnchorMax" smallint
    )
    left join public.career_profile_axis_values a
      on a.profile_version_id = p_profile_version_id
      and a.axis_key = x."axisKey"
    left join public.evaluated_axis_values ev
      on ev.evaluation_id = p_evaluation_id and ev.axis_key = x."axisKey"
    where a.axis_key is null
      or a.preference is distinct from x.preference
      or a.importance is distinct from x.importance
      or coalesce(ev.observation_status, 'unknown')
        is distinct from x."observationStatus"
      or ev.anchor_value is distinct from x."observedAnchor"
      or ev.anchor_max is distinct from x."observedAnchorMax"
  ) then
    raise exception 'match_snapshot_mismatch' using errcode = '22023';
  end if;

  insert into public.match_results as m (
    user_id, career_profile_version_id, evaluation_id,
    axis_catalog_version, algorithm_version
  )
  values (
    p_user_id, p_profile_version_id, p_evaluation_id,
    v_catalog, p_algorithm_version
  )
  on conflict (career_profile_version_id, evaluation_id, algorithm_version)
    do nothing
  returning m.id, m.created_at into v_id, v_created_at;

  if v_id is null then
    select m.id, m.created_at into v_id, v_created_at
    from public.match_results m
    where m.career_profile_version_id = p_profile_version_id
      and m.evaluation_id = p_evaluation_id
      and m.algorithm_version = p_algorithm_version
      and m.user_id = p_user_id;
    return query select v_id, v_created_at, false;
    return;
  end if;

  insert into public.match_axis_results (
    match_result_id, axis_key, axis_version, preference, importance,
    observation_status, observed_anchor, observed_anchor_max,
    comparison_status, difference, difference_max
  )
  select
    v_id, x."axisKey", v_catalog, x.preference, x.importance,
    x."observationStatus", x."observedAnchor", x."observedAnchorMax",
    x."comparisonStatus", x.difference, x."differenceMax"
  from pg_catalog.jsonb_to_recordset(p_axes) as x(
    "axisKey" text, preference smallint, importance smallint,
    "observationStatus" text, "observedAnchor" smallint,
    "observedAnchorMax" smallint, "comparisonStatus" text,
    difference smallint, "differenceMax" smallint
  );

  insert into public.match_constraint_results (match_result_id, kind, status, reason)
  select v_id, x.kind, x.status, x.reason
  from pg_catalog.jsonb_to_recordset(p_constraints) as x(
    kind text, status text, reason text
  );

  return query select v_id, v_created_at, true;
end;
$$;

create or replace function public.read_match_result(
  p_user_id uuid,
  p_match_result_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'matchResultId', m.id,
    'createdAt', m.created_at,
    'algorithmVersion', m.algorithm_version,
    'evaluationId', m.evaluation_id,
    'profileVersion', v.version,
    'axisCatalogVersion', m.axis_catalog_version,
    'axes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'axisKey', a.axis_key,
        'preference', a.preference,
        'importance', a.importance,
        'observationStatus', a.observation_status,
        'observedAnchor', a.observed_anchor,
        'observedAnchorMax', a.observed_anchor_max,
        'comparisonStatus', a.comparison_status,
        'difference', a.difference,
        'differenceMax', a.difference_max
      ) order by a.axis_key)
      from public.match_axis_results a
      where a.match_result_id = m.id
    ), '[]'::jsonb),
    'constraints', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'kind', c.kind, 'status', c.status, 'reason', c.reason
      ) order by pg_catalog.array_position(
        array['min_salary', 'location', 'full_remote'], c.kind))
      from public.match_constraint_results c
      where c.match_result_id = m.id
    ), '[]'::jsonb)
  )
  from public.match_results m
  join public.career_profile_versions v on v.id = m.career_profile_version_id
  where m.id = p_match_result_id and m.user_id = p_user_id;
$$;

commit;
