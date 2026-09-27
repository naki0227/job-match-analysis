-- Run after both Issue #14 migrations against a disposable database.
begin;

create or replace function pg_temp.expect_sqlstate(statement text, expected text)
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
insert into public.profiles(id)
  select id from auth.users;

do $$
begin
  if (select count(*) from public.assessment_axes where axis_version = 1) <> 8 then
    raise exception 'The first catalog must contain all eight documented axes';
  end if;
end;
$$;

insert into public.career_profile_versions (
  id, user_id, version, axis_catalog_version, status
) values (
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001', 1, 1, 'completed'
);
insert into public.career_profile_target_roles (
  profile_version_id, role_order, role_text
) values (
  '20000000-0000-0000-0000-000000000001', 0, 'ソフトウェアエンジニア'
);
insert into public.career_profile_axis_values (
  profile_version_id, axis_key, axis_version, preference, importance
) values (
  '20000000-0000-0000-0000-000000000001', 'autonomy', 1, 75, 100
);
insert into public.career_constraints (
  profile_version_id, min_salary_amount, min_salary_currency,
  min_salary_period, full_remote_required
) values (
  '20000000-0000-0000-0000-000000000001', 5000000, 'JPY', 'year', true
);
insert into public.career_constraint_locations
  (profile_version_id, prefecture_code)
values ('20000000-0000-0000-0000-000000000001', '13');

insert into public.companies(id, name) values
  ('30000000-0000-0000-0000-000000000001', '同名企業'),
  ('30000000-0000-0000-0000-000000000002', '同名企業');
insert into public.source_urls(id, raw_url, normalized_url) values
  ('40000000-0000-0000-0000-000000000001', 'https://example.test/job?utm=x', 'https://example.test/job'),
  ('40000000-0000-0000-0000-000000000002', 'https://example.test/other', 'https://example.test/other');
insert into public.job_postings(id, company_id, source_url_id, title) values (
  '50000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'Engineer'
), (
  '50000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'Designer'
);
insert into public.source_document_versions (
  id, source_url_id, content_hash, fetched_at, extractor_version, extracted_text
) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'hash-a', now() - interval '31 days', 'v1', 'old text'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'hash-b', now(), 'v1', 'fresh text');

insert into public.evaluation_targets (
  id, target_type, company_id, job_posting_id
) values (
  '70000000-0000-0000-0000-000000000001', 'job',
  '30000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001'
);
insert into public.evaluations (
  id, target_id, axis_catalog_version, source_set_hash,
  rubric_version, evaluator_version, model_version
) values (
  '80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', 1,
  'source-set-a', 'rubric-1', 'evaluator-1', 'model-1'
);
insert into public.evaluation_sources(evaluation_id, source_document_version_id)
values ('80000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001');
insert into public.evaluated_axis_values (
  evaluation_id, axis_key, axis_version, observation_status, anchor_value
) values (
  '80000000-0000-0000-0000-000000000001', 'autonomy', 1, 'known', 50
);
insert into public.evaluation_evidence (
  evaluation_id, axis_key, source_document_version_id, excerpt
) values (
  '80000000-0000-0000-0000-000000000001', 'autonomy',
  '60000000-0000-0000-0000-000000000001', '根拠抜粋'
);
insert into public.match_results (
  id, user_id, career_profile_version_id, evaluation_id,
  axis_catalog_version, algorithm_version
) values (
  '90000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000001', 1, 'match-1'
);
insert into public.match_axis_results (
  match_result_id, axis_key, axis_version, preference, importance,
  observation_status, observed_anchor, comparison_status, difference
) values (
  '90000000-0000-0000-0000-000000000001', 'autonomy', 1, 75, 100,
  'known', 50, 'close', 25
);
insert into public.match_constraint_results (
  match_result_id, kind, status, reason
) values (
  '90000000-0000-0000-0000-000000000001', 'min_salary',
  'unmet', 'salary_below_minimum'
);

select pg_temp.expect_sqlstate(
  $$insert into public.source_urls(raw_url, normalized_url)
    values ('https://duplicate.test', 'https://example.test/job')$$, '23505');
select pg_temp.expect_sqlstate(
  $$insert into public.career_profile_axis_values
    values ('20000000-0000-0000-0000-000000000001', 'work_location', 1, 101, 10)$$, '23514');
select pg_temp.expect_sqlstate(
  $$insert into public.career_constraint_locations
    values ('20000000-0000-0000-0000-000000000001', '48')$$, '23514');
select pg_temp.expect_sqlstate(
  $$insert into public.career_constraint_locations
    values ('20000000-0000-0000-0000-000000000001', '13')$$, '23505');
select pg_temp.expect_sqlstate(
  $$insert into public.career_profile_target_roles
    values ('20000000-0000-0000-0000-000000000001', 1, 'ソフトウェアエンジニア')$$, '23505');
select pg_temp.expect_sqlstate(
  $$insert into public.career_profile_target_roles
    values ('20000000-0000-0000-0000-000000000001', 1, '   ')$$, '23514');
select pg_temp.expect_sqlstate(
  $$update public.career_constraints set min_salary_currency = null
    where profile_version_id = '20000000-0000-0000-0000-000000000001'$$, '23514');
select pg_temp.expect_sqlstate(
  $$insert into public.career_profile_axis_values
    values ('20000000-0000-0000-0000-000000000001', 'work_location', 2, 50, 50)$$, '23503');
select pg_temp.expect_sqlstate(
  $$insert into public.evaluation_targets(target_type, company_id, job_posting_id)
    values ('job', '30000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000002')$$, '23503');
select pg_temp.expect_sqlstate(
  $$insert into public.evaluation_evidence
    (evaluation_id, axis_key, source_document_version_id, excerpt)
    values ('80000000-0000-0000-0000-000000000001', 'autonomy',
      '60000000-0000-0000-0000-000000000002', 'not a source')$$, '23503');
select pg_temp.expect_sqlstate(
  $$update public.evaluated_axis_values set anchor_value = null
    where evaluation_id = '80000000-0000-0000-0000-000000000001'$$, '23514');
select pg_temp.expect_sqlstate(
  $$insert into public.match_results
    (user_id, career_profile_version_id, evaluation_id, axis_catalog_version, algorithm_version)
    values ('00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001', 1, 'match-2')$$, '23503');
select pg_temp.expect_sqlstate(
  $$insert into public.match_results
    (user_id, career_profile_version_id, evaluation_id, axis_catalog_version, algorithm_version)
    values ('00000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001', 2, 'match-2')$$, '23503');
select pg_temp.expect_sqlstate(
  $$insert into public.match_constraint_results
    values ('90000000-0000-0000-0000-000000000001', 'location',
      'unmet', 'salary_below_minimum')$$, '23514');
select pg_temp.expect_sqlstate(
  $$insert into public.match_constraint_results
    values ('90000000-0000-0000-0000-000000000001', 'location',
      'unmet', null)$$, '23514');
select pg_temp.expect_sqlstate(
  $$update public.match_axis_results set difference = 26
    where match_result_id = '90000000-0000-0000-0000-000000000001'$$, '23514');
select pg_temp.expect_sqlstate(
  $$delete from public.companies
    where id = '30000000-0000-0000-0000-000000000001'$$, '23503');
select pg_temp.expect_sqlstate(
  $$delete from public.source_document_versions
    where id = '60000000-0000-0000-0000-000000000001'$$, '23503');
select pg_temp.expect_sqlstate(
  $$insert into public.analysis_jobs(source_url_id, analyzer_version, status)
    values ('40000000-0000-0000-0000-000000000001', 'v1', 'invalid')$$, '23514');

insert into public.analysis_jobs(source_url_id, analyzer_version, status)
values ('40000000-0000-0000-0000-000000000001', 'v1', 'queued');
select pg_temp.expect_sqlstate(
  $$insert into public.analysis_jobs(source_url_id, analyzer_version, status)
    values ('40000000-0000-0000-0000-000000000001', 'v1', 'running')$$, '23505');

-- This is the SQL predicate the planned worker will execute; no scheduler yet.
update public.source_document_versions
set extracted_text = null
where extracted_text is not null and fetched_at <= now() - interval '30 days';
do $$
begin
  if (select extracted_text from public.source_document_versions
      where id = '60000000-0000-0000-0000-000000000001') is not null
    or (select extracted_text from public.source_document_versions
      where id = '60000000-0000-0000-0000-000000000002') is null then
    raise exception '30-day text retention predicate failed';
  end if;
end;
$$;

create role issue14_reader;
do $$
begin
  if (select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r') <> 21
    or (select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relrowsecurity) <> 21 then
    raise exception 'Every Issue #14 table must have RLS enabled';
  end if;
end;
$$;
grant usage on schema public to issue14_reader;
grant select on public.companies, public.profiles to issue14_reader;
set local role issue14_reader;
do $$
begin
  if (select count(*) from public.companies) <> 0
    or (select count(*) from public.profiles) <> 0 then
    raise exception 'RLS without policies must hide all rows';
  end if;
end;
$$;
reset role;

-- A user deletion removes personal rows while shared evaluations remain.
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';
do $$
begin
  if exists (select from public.match_results)
    or exists (select from public.career_profile_versions)
    or not exists (select from public.evaluations) then
    raise exception 'Personal cascade or shared data restriction failed';
  end if;
end;
$$;

rollback;
