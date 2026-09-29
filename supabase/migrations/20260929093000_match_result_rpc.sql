-- Match API: store and read personal Match results through server-only RPCs.
-- Tables already exist (Issue #14); this adds atomic write and single-trip reads.
begin;

-- One shared evaluation with its axis observations and public evidence.
create function public.evaluation_match_snapshot(p_evaluation_id uuid)
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
        'anchorValue', v.anchor_value
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

-- The requested evaluation, its target names, and the latest company evaluation.
create function public.read_evaluation_for_match(p_evaluation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'targetType', t.target_type,
    'companyName', c.name,
    'jobTitle', j.title,
    'evaluation', public.evaluation_match_snapshot(e.id),
    'companyEvaluation', (
      select public.evaluation_match_snapshot(ce.id)
      from public.evaluation_targets ct
      join public.evaluations ce on ce.target_id = ct.id
      where ct.target_type = 'company' and ct.company_id = t.company_id
      order by ce.created_at desc, ce.id desc
      limit 1
    )
  )
  from public.evaluations e
  join public.evaluation_targets t on t.id = e.target_id
  join public.companies c on c.id = t.company_id
  left join public.job_postings j on j.id = t.job_posting_id
  where e.id = p_evaluation_id;
$$;

create function public.commit_match_result(
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
      "observationStatus" text, "observedAnchor" smallint
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
    observation_status, observed_anchor, comparison_status, difference
  )
  select
    v_id, x."axisKey", v_catalog, x.preference, x.importance,
    x."observationStatus", x."observedAnchor", x."comparisonStatus",
    x.difference
  from pg_catalog.jsonb_to_recordset(p_axes) as x(
    "axisKey" text, preference smallint, importance smallint,
    "observationStatus" text, "observedAnchor" smallint,
    "comparisonStatus" text, difference smallint
  );

  insert into public.match_constraint_results (match_result_id, kind, status, reason)
  select v_id, x.kind, x.status, x.reason
  from pg_catalog.jsonb_to_recordset(p_constraints) as x(
    kind text, status text, reason text
  );

  return query select v_id, v_created_at, true;
end;
$$;

-- A stored Match of the given user; other users' rows read as missing.
create function public.read_match_result(
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
        'comparisonStatus', a.comparison_status,
        'difference', a.difference
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

revoke all on function public.evaluation_match_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.read_evaluation_for_match(uuid)
  from public, anon, authenticated;
revoke all on function public.commit_match_result(uuid, uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.read_match_result(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.evaluation_match_snapshot(uuid) to service_role;
grant execute on function public.read_evaluation_for_match(uuid) to service_role;
grant execute on function public.commit_match_result(uuid, uuid, uuid, text, jsonb, jsonb)
  to service_role;
grant execute on function public.read_match_result(uuid, uuid) to service_role;

commit;
