-- ADR-043 (Issues #40/#41/#29): consent history, consent-scoped and
-- thresholded aggregates, and the analytics_reader privilege boundary.

-- Earlier fixtures may leave rows; plain usage counts are checked as deltas.
create temp table analytics_baseline as
select coalesce((select active_users from analytics.daily_active_users
  where day = (now() at time zone 'Asia/Tokyo')::date), 0) as dau,
  (select count(*)::integer from public.profiles) as profiles;

-- Fixture: 21 users who all matched one company. Users 1-11 graduate in 2027,
-- users 12-20 in 2028, user 21 never consents.
do $$
declare
  v_keys text[] := array['work_location', 'autonomy', 'collaboration',
    'growth_direction', 'work_change', 'schedule_flexibility',
    'role_breadth', 'customer_contact'];
  v_eval uuid := '40000000-0000-4000-8000-0000000000e1';
  v_user uuid;
  v_profile uuid;
  n integer;
begin
  insert into public.companies(id, name)
    values ('40000000-0000-4000-8000-0000000000c1', 'Analytics Sample Co');
  insert into public.evaluation_targets(id, target_type, company_id)
    values ('40000000-0000-4000-8000-0000000000b1', 'company',
      '40000000-0000-4000-8000-0000000000c1');
  insert into public.evaluations
    (id, target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version)
  values (v_eval, '40000000-0000-4000-8000-0000000000b1', 1, 'analytics-40',
    'r1', 'e1', 'm1');
  insert into public.analytics_consent_policies(id, purpose, version, summary, effective_at)
  values ('40000000-0000-4000-8000-0000000000f1', 'community_benchmark', '1.0',
    '匿名の集計に使う（テスト）', now() - interval '1 day');

  for n in 1..21 loop
    v_user := ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
    v_profile := gen_random_uuid();
    insert into auth.users(id) values (v_user);
    insert into public.profiles(id) values (v_user);
    insert into public.profile_educations(user_id, institution_name, ended_on)
      values (v_user, 'Sample University',
        case when n <= 11 then date '2027-03-31' else date '2028-03-31' end);
    insert into public.career_profile_versions
      (id, user_id, version, axis_catalog_version, status)
    values (v_profile, v_user, 1, 1, 'completed');
    insert into public.career_profile_axis_values
      (profile_version_id, axis_key, axis_version, preference, importance)
    select v_profile, k, 1, 50 + (n % 2) * 50, 50 from unnest(v_keys) k;
    insert into public.match_results
      (user_id, career_profile_version_id, evaluation_id,
       axis_catalog_version, algorithm_version)
    values (v_user, v_profile, v_eval, 1, 'match-engine-v1');
  end loop;
end;
$$;

-- Grants go through the server-only RPC, as the API would call it.
set role service_role;
select public.record_analytics_consent(
  ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '40000000-0000-4000-8000-0000000000f1', 'granted')
from generate_series(1, 20) n;
-- Repeating a decision and withdrawing without a grant record nothing.
select public.record_analytics_consent('40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-0000000000f1', 'granted');
select public.record_analytics_consent('40000000-0000-4000-8000-000000000021',
  '40000000-0000-4000-8000-0000000000f1', 'withdrawn');
reset role;

do $$
declare
  v_count integer;
  v_users integer;
begin
  select count(*) into v_count from public.analytics_consent_events;
  if v_count <> 20 then
    raise exception 'Expected 20 consent events, got %', v_count;
  end if;
  if (select granted from public.analytics_consent_status(
        '40000000-0000-4000-8000-000000000001')) is not true
    or (select granted from public.analytics_consent_status(
        '40000000-0000-4000-8000-000000000021')) is not false then
    raise exception 'Consent status does not reflect the history';
  end if;

  select consented_users, total_users into v_count, v_users
  from analytics.consent_rate where purpose = 'community_benchmark';
  if v_count <> 20 or v_users <> 21 + (select profiles from analytics_baseline) then
    raise exception 'consent_rate % / %', v_count, v_users;
  end if;

  -- The non-consenting user is not part of consent-scoped aggregates.
  select users into v_users from analytics.company_interest_daily
  where company_name = 'Analytics Sample Co';
  if v_users is distinct from 20 then
    raise exception 'company_interest_daily counted % users', v_users;
  end if;

  -- 2027 has 11 consenting members; 2028 has 9 and stays hidden.
  select max(users) into v_users from analytics.cohort_axis_distribution
  where graduation_year = 2027;
  if v_users is distinct from 11 then
    raise exception 'cohort 2027 has % users', v_users;
  end if;
  if exists (select 1 from analytics.cohort_axis_distribution
             where graduation_year = 2028) then
    raise exception 'A cohort below the threshold was returned';
  end if;

  if (select active_users from analytics.daily_active_users
      where day = (now() at time zone 'Asia/Tokyo')::date)
      <> 21 + (select dau from analytics_baseline) then
    raise exception 'daily_active_users is not a plain usage count';
  end if;
end;
$$;

-- Withdrawals remove users from aggregates computed afterwards.
set role service_role;
select public.record_analytics_consent(
  ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '40000000-0000-4000-8000-0000000000f1', 'withdrawn')
from generate_series(1, 2) n;
reset role;

do $$
begin
  if exists (select 1 from analytics.cohort_axis_distribution
             where graduation_year = 2027) then
    raise exception 'Withdrawn users still count toward cohort 2027';
  end if;
  if (select users from analytics.company_interest_daily
      where company_name = 'Analytics Sample Co') <> 18 then
    raise exception 'Withdrawn users still count toward company interest';
  end if;
end;
$$;

-- Deleting an account removes it from every aggregate (Issue #29).
delete from auth.users where id = '40000000-0000-4000-8000-000000000003';
do $$
begin
  if (select users from analytics.company_interest_daily
        where company_name = 'Analytics Sample Co') <> 17
    or (select active_users from analytics.daily_active_users
        where day = (now() at time zone 'Asia/Tokyo')::date)
        <> 20 + (select dau from analytics_baseline)
    or (select total_users from analytics.consent_rate
        where purpose = 'community_benchmark')
        <> 20 + (select profiles from analytics_baseline) then
    raise exception 'A deleted account still counts in analytics views';
  end if;
end;
$$;

-- A new policy version needs a new grant; the outdated one is refused.
insert into public.analytics_consent_policies(id, purpose, version, summary, effective_at)
values ('40000000-0000-4000-8000-0000000000f2', 'community_benchmark', '1.1',
  '匿名の集計に使う（テスト改訂）', now());
do $$
begin
  if (select consented_users from analytics.consent_rate
      where purpose = 'community_benchmark') <> 0
    or exists (select 1 from analytics.company_interest_daily
      where company_name = 'Analytics Sample Co') then
    raise exception 'Grants of an outdated policy still count';
  end if;
  begin
    set local role service_role;
    perform public.record_analytics_consent('40000000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-0000000000f1', 'granted');
    raise exception 'An outdated policy grant was accepted';
  exception when sqlstate 'P0409' then
    null;
  end;
end;
$$;
reset role;

-- analytics_reader reads aggregate views only.
begin;
set local role analytics_reader;
select count(*) from analytics.daily_active_users;
select count(*) from analytics.analysis_usage_daily;
select count(*) from analytics.consent_rate;
select count(*) from analytics.unknown_rate_daily;
select count(*) from analytics.evaluator_method_daily;
select count(*) from analytics.external_api_cost_daily;
select count(*) from analytics.company_interest_daily;
select count(*) from analytics.cohort_axis_distribution;
do $$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    'select 1 from public.profiles',
    'select 1 from public.career_profile_axis_values',
    'select 1 from public.profile_educations',
    'select 1 from public.analytics_consent_events',
    'select 1 from analytics_private.consented_users',
    'select public.analytics_consent_status(gen_random_uuid())',
    'select public.record_analytics_consent(gen_random_uuid(), gen_random_uuid(), ''granted'')'
  ] loop
    begin
      execute v_sql;
      raise exception 'analytics_reader could run: %', v_sql;
    exception when insufficient_privilege or invalid_schema_name then
      null;
    end;
  end loop;
end;
$$;
commit;

-- Client and server roles cannot read the analytics schemas.
do $$
declare
  v_violation text;
begin
  select string_agg(format('%s:%s.%s', r.role, n.nspname, c.relname), ', ')
    into v_violation
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
  where n.nspname in ('analytics', 'analytics_private')
    and has_table_privilege(r.role, c.oid, 'SELECT');
  if v_violation is not null then
    raise exception 'Unexpected analytics privileges: %', v_violation;
  end if;
  if exists (select 1 from pg_roles where rolname = 'analytics_reader'
             and (rolcanlogin or rolsuper or rolbypassrls or rolinherit
               or rolcreaterole or rolcreatedb))
    or exists (select 1 from pg_auth_members m
               where m.member = 'analytics_reader'::regrole) then
    raise exception 'analytics_reader must be a plain NOLOGIN role';
  end if;
end;
$$;

delete from auth.users where id::text like '40000000-%';
delete from public.analytics_consent_policies where id::text like '40000000-%';
delete from public.evaluations where id = '40000000-0000-4000-8000-0000000000e1';
delete from public.evaluation_targets where id = '40000000-0000-4000-8000-0000000000b1';
delete from public.companies where id = '40000000-0000-4000-8000-0000000000c1';
drop table analytics_baseline;
