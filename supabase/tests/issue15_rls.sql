-- Run after Issue #15 migration against a disposable database.
begin;

create function pg_temp.expect_sqlstate(statement text, expected text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected SQLSTATE %, but statement succeeded: %', expected, statement;
exception when others then
  if sqlstate = expected then
    return;
  end if;
  raise;
end;
$$;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
insert into public.profiles(id) select id from auth.users;

insert into public.career_profile_versions
  (id, user_id, version, axis_catalog_version, status)
values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1, 1, 'completed'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 1, 1, 'completed');
insert into public.career_profile_target_roles
  (profile_version_id, role_order, role_text)
values
  ('20000000-0000-0000-0000-000000000001', 0, 'Engineer'),
  ('20000000-0000-0000-0000-000000000002', 0, 'Designer');
insert into public.career_profile_axis_values
  (profile_version_id, axis_key, axis_version, preference, importance)
values
  ('20000000-0000-0000-0000-000000000001', 'autonomy', 1, 50, 50),
  ('20000000-0000-0000-0000-000000000002', 'autonomy', 1, 50, 50);
insert into public.career_constraints(profile_version_id)
values
  ('20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002');
insert into public.career_constraint_locations(profile_version_id, prefecture_code)
values
  ('20000000-0000-0000-0000-000000000001', '13'),
  ('20000000-0000-0000-0000-000000000002', '27');

insert into public.companies(id, name)
values ('30000000-0000-0000-0000-000000000001', 'Shared Company');
insert into public.job_postings(id, company_id, title)
values ('50000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 'Shared Job');
insert into public.evaluation_targets(id, target_type, company_id, job_posting_id)
values ('70000000-0000-0000-0000-000000000001', 'job',
  '30000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001');
insert into public.evaluations
  (id, target_id, axis_catalog_version, source_set_hash,
   rubric_version, evaluator_version, model_version)
values ('80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', 1,
  'source', 'rubric', 'evaluator', 'model');
insert into public.user_saved_jobs(user_id, job_posting_id)
values
  ('00000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
insert into public.match_results
  (id, user_id, career_profile_version_id, evaluation_id,
   axis_catalog_version, algorithm_version)
values
  ('90000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000001', 1, 'v1'),
  ('90000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '80000000-0000-0000-0000-000000000001', 1, 'v1');
insert into public.match_axis_results
  (match_result_id, axis_key, axis_version, preference, importance,
   observation_status, comparison_status)
values
  ('90000000-0000-0000-0000-000000000001', 'autonomy', 1, 50, 50, 'unknown', 'unknown'),
  ('90000000-0000-0000-0000-000000000002', 'autonomy', 1, 50, 50, 'unknown', 'unknown');
insert into public.match_constraint_results(match_result_id, kind, status)
values
  ('90000000-0000-0000-0000-000000000001', 'min_salary', 'not_required'),
  ('90000000-0000-0000-0000-000000000002', 'min_salary', 'not_required');

do $$
declare
  table_name text;
  operation text;
begin
  foreach table_name in array array[
    'profiles', 'assessment_axes', 'career_profile_versions',
    'career_profile_target_roles', 'career_profile_axis_values',
    'career_constraints', 'career_constraint_locations', 'companies',
    'source_urls', 'job_postings', 'source_document_versions',
    'evaluation_targets', 'evaluations', 'evaluation_sources',
    'evaluated_axis_values', 'evaluation_evidence', 'analysis_jobs',
    'user_saved_jobs', 'match_results', 'match_axis_results',
    'match_constraint_results'
  ] loop
    foreach operation in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege('authenticated', 'public.' || table_name, operation)
        or has_table_privilege('anon', 'public.' || table_name, operation) then
        raise exception 'Client write grant remains on % (%)', table_name, operation;
      end if;
    end loop;
  end loop;
end;
$$;

set local role anon;
select pg_temp.expect_sqlstate('select * from public.profiles', '42501');
select pg_temp.expect_sqlstate('select * from public.companies', '42501');
reset role;

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $$
declare
  table_name text;
  visible_count integer;
begin
  foreach table_name in array array[
    'profiles', 'career_profile_versions', 'career_profile_target_roles',
    'career_profile_axis_values', 'career_constraints',
    'career_constraint_locations', 'user_saved_jobs', 'match_results',
    'match_axis_results', 'match_constraint_results'
  ] loop
    execute format('select count(*) from public.%I', table_name)
      into visible_count;
    if visible_count <> 1 then
      raise exception 'Owner should see one row in %, got %',
        table_name, visible_count;
    end if;
  end loop;
end;
$$;
select pg_temp.expect_sqlstate('select * from public.companies', '42501');
select pg_temp.expect_sqlstate(
  $$insert into public.profiles(id) values
    ('00000000-0000-0000-0000-000000000002')$$, '42501');
select pg_temp.expect_sqlstate(
  $$update public.profiles set created_at = now() where id =
    '00000000-0000-0000-0000-000000000002'$$, '42501');
select pg_temp.expect_sqlstate(
  $$delete from public.profiles where id =
    '00000000-0000-0000-0000-000000000002'$$, '42501');
select pg_temp.expect_sqlstate(
  $$insert into public.career_profile_target_roles
    (profile_version_id, role_order, role_text) values
    ('20000000-0000-0000-0000-000000000002', 1, 'Other')$$, '42501');
select pg_temp.expect_sqlstate(
  $$update public.career_profile_target_roles set role_text = 'Other'
    where profile_version_id = '20000000-0000-0000-0000-000000000002'$$,
  '42501');
select pg_temp.expect_sqlstate(
  $$delete from public.career_profile_target_roles where
    profile_version_id = '20000000-0000-0000-0000-000000000002'$$,
  '42501');
select pg_temp.expect_sqlstate(
  $$insert into public.match_constraint_results(match_result_id, kind, status)
    values ('90000000-0000-0000-0000-000000000002', 'location', 'not_required')$$,
  '42501');
select pg_temp.expect_sqlstate(
  $$update public.match_constraint_results set status = 'unknown',
    reason = 'missing_information' where match_result_id =
    '90000000-0000-0000-0000-000000000002'$$, '42501');
select pg_temp.expect_sqlstate(
  $$delete from public.match_constraint_results where match_result_id =
    '90000000-0000-0000-0000-000000000002'$$, '42501');
reset role;

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.profiles) <> 1
    or (select id from public.profiles) <>
      '00000000-0000-0000-0000-000000000002'::uuid
    or (select count(*) from public.match_results) <> 1
    or (select user_id from public.match_results) <>
      '00000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'User B owner filtering failed';
  end if;
end;
$$;
reset role;

-- service_role table privileges are granted later by
-- 20260930120544_service_role_core_privileges and checked in
-- service_role_core_privileges.sql.

rollback;
