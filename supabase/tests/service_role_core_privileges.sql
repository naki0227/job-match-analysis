-- service_role table privileges must be granted by migrations, exactly as the
-- API, crawler and SECURITY INVOKER RPCs need them. The local role fixture no
-- longer grants anything, like hosted Supabase.

-- 1. Exact privilege matrix: every public table is listed, nothing missing
--    and nothing extra. A new table must be added here on purpose.
do $$
declare
  v_violation text;
begin
  create temporary table expected_service_privileges (
    table_name text primary key,
    privileges text[] not null
  ) on commit drop;
  insert into expected_service_privileges values
    ('abuse_signal_events', '{SELECT,INSERT,DELETE}'),
    ('analysis_jobs', '{SELECT,INSERT,UPDATE}'),
    ('assessment_axes', '{SELECT}'),
    ('career_constraint_locations', '{SELECT,INSERT}'),
    ('career_constraints', '{SELECT,INSERT}'),
    ('career_profile_axis_values', '{SELECT,INSERT}'),
    ('career_profile_target_roles', '{SELECT,INSERT}'),
    ('career_profile_versions', '{SELECT,INSERT}'),
    ('companies', '{SELECT,INSERT}'),
    ('evaluated_axis_values', '{SELECT,INSERT,UPDATE}'),
    ('evaluation_evidence', '{SELECT,INSERT}'),
    ('evaluation_job_facts', '{SELECT,INSERT}'),
    ('evaluation_sources', '{SELECT,INSERT}'),
    ('evaluation_targets', '{SELECT,INSERT,UPDATE}'),
    ('evaluations', '{SELECT,INSERT}'),
    ('jev_daily_usage', '{SELECT,INSERT,UPDATE}'),
    ('job_discovery_access', '{SELECT,INSERT}'),
    ('job_discovery_requests', '{SELECT,INSERT,UPDATE,DELETE}'),
    ('job_discovery_results', '{SELECT,INSERT}'),
    ('job_postings', '{SELECT,INSERT}'),
    ('job_resolver_events', '{SELECT,INSERT,DELETE}'),
    ('legal_documents', '{SELECT,INSERT}'),
    ('match_axis_results', '{SELECT,INSERT}'),
    ('match_constraint_results', '{SELECT,INSERT}'),
    ('match_results', '{SELECT,INSERT,UPDATE}'),
    ('match_shares', '{SELECT,INSERT,UPDATE}'),
    ('profile_educations', '{SELECT,INSERT,UPDATE,DELETE}'),
    ('profiles', '{SELECT,INSERT,UPDATE}'),
    ('source_document_versions', '{SELECT,INSERT,UPDATE}'),
    ('source_urls', '{SELECT,INSERT,UPDATE}'),
    ('user_analysis_quota_events', '{SELECT,INSERT}'),
    ('user_analysis_requests', '{SELECT,INSERT,UPDATE}'),
    ('user_legal_acknowledgements', '{SELECT,INSERT}');

  select string_agg(c.relname, ', ') into v_violation
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from expected_service_privileges e
      where e.table_name = c.relname);
  if v_violation is not null then
    raise exception 'Tables without an expected service_role entry: %', v_violation;
  end if;

  select string_agg(format('%s:%s expected=%s', e.table_name, p.priv,
      p.priv = any(e.privileges)), ', ')
    into v_violation
  from expected_service_privileges e
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
  where to_regclass('public.' || e.table_name) is not null
    and has_table_privilege('service_role', 'public.' || e.table_name, p.priv)
    is distinct from (p.priv = any(e.privileges));
  if v_violation is not null then
    raise exception 'service_role privileges differ: %', v_violation;
  end if;

  -- Granting the server did not widen the client boundary (see also
  -- issue29_security.sql for the full client allowlist).
  select string_agg(format('%s:%s:%s', r.role, c.relname, p.priv), ', ')
    into v_violation
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(role)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
  where n.nspname = 'public' and c.relkind = 'r'
    and has_table_privilege(r.role, c.oid, p.priv);
  if v_violation is not null then
    raise exception 'Clients can write tables: %', v_violation;
  end if;
end;
$$;

-- 2. The PostgREST calls the API and crawler make, and the full job
--    lifecycle through the SECURITY INVOKER RPCs, run as service_role.
begin;
insert into auth.users(id) values ('5e000000-0000-4000-8000-000000000001');
set local role service_role;
do $$
declare
  v_user uuid := '5e000000-0000-4000-8000-000000000001';
  v_axes jsonb;
  v_profile uuid;
  v_request record;
  v_claimed record;
  v_token uuid := '5e000000-0000-4000-8000-000000000002';
  v_target uuid;
  v_payload jsonb;
  v_evaluation uuid;
  v_i integer;
begin
  -- API: profile bootstrap (upsert ignoring duplicates) and reads.
  insert into public.profiles(id) values (v_user) on conflict (id) do nothing;
  insert into public.profiles(id) values (v_user) on conflict (id) do nothing;
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1, 'preference', 50, 'importance', 50
  ) order by axis_key) into v_axes
  from public.assessment_axes where axis_version = 1;
  select profile_version_id into v_profile from public.commit_career_profile(
    v_user, 0, '5e000000-0000-4000-8000-000000000003', jsonb_build_object(
      'axisCatalogVersion', 1, 'targetRoles', jsonb_build_array('エンジニア'),
      'axisValues', v_axes,
      'constraints', jsonb_build_object(
        'minSalaryAmount', null, 'minSalaryCurrency', null,
        'minSalaryPeriod', null, 'fullRemoteRequired', false,
        'allowedPrefectureCodes', jsonb_build_array('13'))));
  perform 1 from public.career_profile_versions where id = v_profile;
  perform 1 from public.career_profile_target_roles where profile_version_id = v_profile;
  perform 1 from public.career_profile_axis_values where profile_version_id = v_profile;
  perform 1 from public.career_constraints where profile_version_id = v_profile;
  perform 1 from public.career_constraint_locations where profile_version_id = v_profile;

  -- API: accept an analysis; read the shared job.
  select * into v_request from public.request_personal_analysis_limited(
    v_user, 'https://example.org/service-role', 'https://example.org/service-role',
    'service-role-v1', '2026-09-01T00:00:00Z', now() - interval '1 day', 10);
  perform 1 from public.analysis_jobs where id = v_request.job_id;

  -- Crawler: claim until our job comes up (earlier tests left queued jobs;
  -- everything here is rolled back).
  for v_i in 1..200 loop
    select * into v_claimed from public.claim_analysis_job(v_token, 300, 3);
    exit when v_claimed.job_id is null or v_claimed.job_id = v_request.job_id;
  end loop;
  if v_claimed.job_id is distinct from v_request.job_id then
    raise exception 'service_role could not claim the job';
  end if;
  if not public.renew_analysis_job_lease(v_request.job_id, v_token, 300) then
    raise exception 'service_role could not renew the lease';
  end if;
  perform 1 from public.source_urls where id = v_request.source_url_id;
  v_target := public.resolve_job_evaluation_target(
    v_request.job_id, v_token, 'Engineer', 'Service Role Co');

  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1, 'observationStatus', 'unknown',
    'anchorValue', null, 'evaluationMethod', 'deterministic'
  ) order by axis_key) into v_payload
  from public.assessment_axes where axis_version = 1;
  v_evaluation := public.commit_analysis_evaluation_v2(
    v_request.job_id, v_token, v_target,
    jsonb_build_array(jsonb_build_object(
      'sourceUrlId', v_request.source_url_id, 'contentHash', 'service-role',
      'fetchedAt', '2026-09-30T00:00:00Z', 'extractorVersion', 'html-v1',
      'extractedText', '[job] service role')),
    jsonb_build_object(
      'axisCatalogVersion', 1, 'sourceSetHash', 'service-role',
      'rubricVersion', 'public-anchors-v1', 'evaluatorVersion', 'pipeline-v1',
      'modelVersion', 'not-called', 'axisValues', v_payload,
      'evidence', '[]'::jsonb, 'jobFacts', '{}'::jsonb));
  if v_evaluation is null then
    raise exception 'service_role could not commit an evaluation';
  end if;

  -- Crawler: 30-day retention reads and clears source text.
  perform id from public.source_document_versions
    where extracted_text is not null and fetched_at < now() - interval '30 days'
    order by fetched_at limit 100;
  with cleared as (
    update public.source_document_versions set extracted_text = null
    where source_url_id = v_request.source_url_id and extracted_text is not null
    returning id
  ) select count(*) into v_i from cleared;
  if v_i <> 1 then
    raise exception 'service_role could not clear source text';
  end if;

  -- Crawler: Jev budget and failing another claimed job.
  perform public.reserve_jev_budget(1, 10);
  perform public.fail_analysis_job(v_request.job_id, v_token);
end;
$$;
reset role;
rollback;
