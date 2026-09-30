-- Issue #29: attack-side checks after every migration is applied.
-- 1) catalog-wide privilege guard, 2) cross-user reads, 3) account deletion.

-- 1) Every public table has RLS, clients may only SELECT an explicit list, and
--    no public function is executable by client roles.
do $$
declare
  v_violation text;
begin
  select string_agg(c.relname, ', ') into v_violation
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_violation is not null then
    raise exception 'Tables without RLS: %', v_violation;
  end if;

  select string_agg(format('%s:%s:%s', r.role, c.relname, p.priv), ', ')
    into v_violation
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(role)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
  where n.nspname = 'public' and c.relkind = 'r'
    and has_table_privilege(r.role, c.oid, p.priv)
    and not (
      p.priv = 'SELECT' and (
        c.relname = 'legal_documents'
        or (r.role = 'authenticated' and c.relname in (
          'profiles', 'profile_educations', 'user_legal_acknowledgements',
          'career_profile_versions', 'career_profile_target_roles',
          'career_profile_axis_values', 'career_constraints',
          'career_constraint_locations', 'match_results',
          'match_axis_results', 'match_constraint_results'))
      )
    );
  if v_violation is not null then
    raise exception 'Unexpected client table privileges: %', v_violation;
  end if;

  select string_agg(format('%s:%s', r.role, p.oid::regprocedure), ', ')
    into v_violation
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) r(role)
  where n.nspname = 'public'
    and has_function_privilege(r.role, p.oid, 'EXECUTE');
  if v_violation is not null then
    raise exception 'Client roles can execute public functions: %', v_violation;
  end if;
end;
$$;

-- Fixture: two users with personal rows, plus shared company/job data.
do $$
declare
  v_keys text[] := array['work_location', 'autonomy', 'collaboration',
    'growth_direction', 'work_change', 'schedule_flexibility',
    'role_breadth', 'customer_contact'];
  v_user uuid;
  v_profile uuid;
  v_eval uuid := '29000000-0000-4000-8000-0000000000e1';
  v_doc uuid;
  v_match uuid;
begin
  insert into public.companies(id, name)
    values ('29000000-0000-4000-8000-0000000000c1', 'Security Sample Co');
  insert into public.job_postings(id, company_id, title)
    values ('29000000-0000-4000-8000-0000000000a1',
      '29000000-0000-4000-8000-0000000000c1', 'Security Sample Job');
  insert into public.evaluation_targets(id, target_type, company_id, job_posting_id)
    values ('29000000-0000-4000-8000-0000000000b1', 'job',
      '29000000-0000-4000-8000-0000000000c1',
      '29000000-0000-4000-8000-0000000000a1');
  insert into public.evaluations
    (id, target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version)
  values (v_eval, '29000000-0000-4000-8000-0000000000b1', 1, 'security-29',
    'r1', 'e1', 'm1');
  insert into public.source_urls(id, raw_url, normalized_url)
    values ('29000000-0000-4000-8000-0000000000d1',
      'https://jobs.example.org/security', 'https://jobs.example.org/security');
  insert into public.source_document_versions
    (source_url_id, content_hash, fetched_at, extractor_version)
  values ('29000000-0000-4000-8000-0000000000d1', 'hash-29', now(), 'x1')
  returning id into v_doc;
  insert into public.evaluation_sources(evaluation_id, source_document_version_id)
    values (v_eval, v_doc);
  insert into public.legal_documents
    (id, document_type, version, body_markdown, published_at, effective_at)
  values ('29000000-0000-4000-8000-0000000000f1', 'terms', 'security-29',
    '利用規約（テスト）', now(), now());

  foreach v_user in array array[
    '29000000-0000-4000-8000-000000000001'::uuid,
    '29000000-0000-4000-8000-000000000002'::uuid
  ] loop
    v_profile := gen_random_uuid();
    insert into auth.users(id) values (v_user);
    insert into public.profiles(id) values (v_user);
    insert into public.profile_educations(user_id, institution_name)
      values (v_user, 'Sample University');
    insert into public.user_legal_acknowledgements
      (user_id, legal_document_id, action)
    values (v_user, '29000000-0000-4000-8000-0000000000f1', 'accepted');
    insert into public.career_profile_versions
      (id, user_id, version, axis_catalog_version, status)
    values (v_profile, v_user, 1, 1, 'completed');
    insert into public.career_profile_target_roles
      (profile_version_id, role_order, role_text)
    values (v_profile, 0, 'Engineer');
    insert into public.career_profile_axis_values
      (profile_version_id, axis_key, axis_version, preference, importance)
    select v_profile, k, 1, 50, 50 from unnest(v_keys) k;
    insert into public.career_constraints(profile_version_id, min_salary_amount,
      min_salary_currency, min_salary_period)
    values (v_profile, 7000000, 'JPY', 'year');
    insert into public.career_constraint_locations(profile_version_id, prefecture_code)
      values (v_profile, '13');
    insert into public.match_results
      (user_id, career_profile_version_id, evaluation_id,
       axis_catalog_version, algorithm_version)
    values (v_user, v_profile, v_eval, 1, 'match-engine-v1')
    returning id into v_match;
    insert into public.match_axis_results
      (match_result_id, axis_key, axis_version, preference, importance,
       observation_status, observed_anchor, comparison_status, difference)
    select v_match, k, 1, 50, 50, 'unknown', null, 'unknown', null
    from unnest(v_keys) k;
    insert into public.match_constraint_results(match_result_id, kind, status, reason)
      values (v_match, 'min_salary', 'unknown', 'missing_information');
    insert into public.match_shares(user_id, match_result_id, token, projection)
    values (v_user, v_match,
      substr(replace(v_user::text, '-', '') || repeat('x', 43), 1, 43),
      jsonb_build_object('companyName', 'Security Sample Co',
        'jobTitle', 'Security Sample Job', 'evaluatedAt', now(),
        'axes', (select jsonb_agg(jsonb_build_object('axisKey', k, 'status', 'unknown'))
          from unnest(v_keys) k)));
    insert into public.user_analysis_requests
      (user_id, source_url_id, requested_evaluation_id)
    values (v_user, '29000000-0000-4000-8000-0000000000d1', v_eval);
    insert into public.user_analysis_quota_events(user_id, source_url_id)
      values (v_user, '29000000-0000-4000-8000-0000000000d1');
  end loop;
end;
$$;

-- 2) As user 1, every readable personal table shows only user 1's rows, and
--    no client can write or read service-only personal tables.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
do $$
declare
  v_other uuid := '29000000-0000-4000-8000-000000000002';
  v_count integer;
  v_table text;
begin
  select count(*) into v_count from (
    select id as owner from public.profiles where id = v_other
    union all select user_id from public.profile_educations where user_id = v_other
    union all select user_id from public.user_legal_acknowledgements where user_id = v_other
    union all select user_id from public.career_profile_versions where user_id = v_other
    union all select v.user_id from public.career_profile_target_roles t
      join public.career_profile_versions v on v.id = t.profile_version_id
      where v.user_id = v_other
    union all select v.user_id from public.career_profile_axis_values a
      join public.career_profile_versions v on v.id = a.profile_version_id
      where v.user_id = v_other
    union all select v.user_id from public.career_constraints c
      join public.career_profile_versions v on v.id = c.profile_version_id
      where v.user_id = v_other
    union all select v.user_id from public.career_constraint_locations l
      join public.career_profile_versions v on v.id = l.profile_version_id
      where v.user_id = v_other
    union all select user_id from public.match_results where user_id = v_other
    union all select m.user_id from public.match_axis_results a
      join public.match_results m on m.id = a.match_result_id
      where m.user_id = v_other
    union all select m.user_id from public.match_constraint_results c
      join public.match_results m on m.id = c.match_result_id
      where m.user_id = v_other
  ) visible;
  if v_count <> 0 then
    raise exception 'User 1 can read % rows of user 2', v_count;
  end if;
  if (select count(*) from public.match_results) <> 1
    or (select count(*) from public.match_axis_results) <> 8 then
    raise exception 'User 1 cannot read exactly their own Match';
  end if;

  foreach v_table in array array['match_shares', 'user_analysis_requests',
    'user_analysis_quota_events', 'jev_daily_usage',
    'evaluations', 'source_document_versions'] loop
    begin
      execute format('select count(*) from public.%I', v_table);
      raise exception 'authenticated can read %', v_table;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    update public.match_results set algorithm_version = 'tampered';
    raise exception 'authenticated can update Match rows';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.career_profile_versions;
    raise exception 'authenticated can delete profile versions';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;

-- 3) Deleting the auth user removes every personal row and share link, while
--    shared company, job, evaluation and source data remain.
do $$
declare
  v_user uuid := '29000000-0000-4000-8000-000000000001';
  v_other uuid := '29000000-0000-4000-8000-000000000002';
  v_remaining integer;
begin
  delete from auth.users where id = v_user;
  select
    (select count(*) from public.profiles where id = v_user)
    + (select count(*) from public.profile_educations where user_id = v_user)
    + (select count(*) from public.user_legal_acknowledgements where user_id = v_user)
    + (select count(*) from public.career_profile_versions where user_id = v_user)
    + (select count(*) from public.match_results where user_id = v_user)
    + (select count(*) from public.match_shares where user_id = v_user)
    + (select count(*) from public.user_analysis_requests where user_id = v_user)
    + (select count(*) from public.user_analysis_quota_events where user_id = v_user)
    + (select count(*) from public.career_profile_axis_values a
        where not exists (select 1 from public.career_profile_versions v
          where v.id = a.profile_version_id))
    + (select count(*) from public.match_axis_results a
        where not exists (select 1 from public.match_results m
          where m.id = a.match_result_id))
    into v_remaining;
  if v_remaining <> 0 then
    raise exception 'Account deletion left % personal rows', v_remaining;
  end if;
  if (select count(*) from public.match_results where user_id = v_other) <> 1
    or (select count(*) from public.match_shares where user_id = v_other) <> 1
    or not exists (select 1 from public.evaluations
      where id = '29000000-0000-4000-8000-0000000000e1')
    or not exists (select 1 from public.job_postings
      where id = '29000000-0000-4000-8000-0000000000a1')
    or not exists (select 1 from public.source_document_versions d
      join public.source_urls s on s.id = d.source_url_id
      where s.normalized_url = 'https://jobs.example.org/security')
    or not exists (select 1 from public.legal_documents
      where id = '29000000-0000-4000-8000-0000000000f1') then
    raise exception 'Account deletion touched shared data or another user';
  end if;
end;
$$;
