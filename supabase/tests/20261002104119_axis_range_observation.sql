-- ADR-049: a range observation spans two adjacent anchors and a Match
-- compares it by both ends. Malformed ranges and comparisons are rejected.
begin;

create or replace function pg_temp.expect_check(statement text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected a check violation, but statement succeeded: %', statement;
exception when check_violation then
  return;
end;
$$;

insert into auth.users(id) values ('a4900000-0000-4000-8000-000000000001');
insert into public.profiles(id) values ('a4900000-0000-4000-8000-000000000001');
insert into public.career_profile_versions (id, user_id, version, axis_catalog_version, status)
  values ('a4900000-0000-4000-8000-000000000002',
    'a4900000-0000-4000-8000-000000000001', 1, 1, 'completed');
insert into public.companies(id, name) values ('a4900000-0000-4000-8000-000000000003', 'Range Co');
insert into public.evaluation_targets(id, target_type, company_id)
  values ('a4900000-0000-4000-8000-000000000004', 'company',
    'a4900000-0000-4000-8000-000000000003');
insert into public.evaluations(id, target_id, axis_catalog_version, source_set_hash,
    rubric_version, evaluator_version, model_version)
  values ('a4900000-0000-4000-8000-000000000005',
    'a4900000-0000-4000-8000-000000000004', 1, 'range', 'r', 'e', 'm');

-- Valid observations: range, plus the old shapes with anchor_max NULL.
insert into public.evaluated_axis_values
  (evaluation_id, axis_key, axis_version, observation_status, anchor_value, anchor_max)
values
  ('a4900000-0000-4000-8000-000000000005', 'role_breadth', 1, 'range', 50, 100),
  ('a4900000-0000-4000-8000-000000000005', 'work_change', 1, 'range', 0, 50),
  ('a4900000-0000-4000-8000-000000000005', 'autonomy', 1, 'known', 100, null),
  ('a4900000-0000-4000-8000-000000000005', 'collaboration', 1, 'unknown', null, null);

select pg_temp.expect_check($$insert into public.evaluated_axis_values
  (evaluation_id, axis_key, axis_version, observation_status, anchor_value, anchor_max)
  values ('a4900000-0000-4000-8000-000000000005', 'customer_contact', 1, 'range', 0, 100)$$);
select pg_temp.expect_check($$insert into public.evaluated_axis_values
  (evaluation_id, axis_key, axis_version, observation_status, anchor_value, anchor_max)
  values ('a4900000-0000-4000-8000-000000000005', 'customer_contact', 1, 'range', 50, null)$$);
select pg_temp.expect_check($$insert into public.evaluated_axis_values
  (evaluation_id, axis_key, axis_version, observation_status, anchor_value, anchor_max)
  values ('a4900000-0000-4000-8000-000000000005', 'customer_contact', 1, 'known', 50, 100)$$);
select pg_temp.expect_check($$insert into public.evaluated_axis_values
  (evaluation_id, axis_key, axis_version, observation_status, anchor_value, anchor_max)
  values ('a4900000-0000-4000-8000-000000000005', 'customer_contact', 1, 'range', 100, 150)$$);

do $$
declare
  v_snapshot jsonb := public.evaluation_match_snapshot('a4900000-0000-4000-8000-000000000005');
begin
  if not (v_snapshot -> 'axisValues') @> '[{"axisKey":"role_breadth","observationStatus":"range","anchorValue":50,"anchorMax":100}]'
    or not (v_snapshot -> 'axisValues') @> '[{"axisKey":"autonomy","anchorMax":null}]' then
    raise exception 'snapshot does not carry anchorMax: %', v_snapshot;
  end if;
end;
$$;

insert into public.match_results (id, user_id, career_profile_version_id, evaluation_id,
    axis_catalog_version, algorithm_version)
  values ('a4900000-0000-4000-8000-000000000006',
    'a4900000-0000-4000-8000-000000000001', 'a4900000-0000-4000-8000-000000000002',
    'a4900000-0000-4000-8000-000000000005', 1, 'match-range');

-- preference 100 vs 50/100: nearest 0, farthest 50 -> partial.
-- preference 75 vs 50/100: both documented anchors are 25 away -> close.
-- preference 100 vs 0〜50: nearest end 50 away -> different.
insert into public.match_axis_results (match_result_id, axis_key, axis_version,
    preference, importance, observation_status, observed_anchor,
    observed_anchor_max, comparison_status, difference, difference_max)
values
  ('a4900000-0000-4000-8000-000000000006', 'role_breadth', 1, 100, 80,
    'range', 50, 100, 'partial', 0, 50),
  ('a4900000-0000-4000-8000-000000000006', 'growth_direction', 1, 75, 80,
    'range', 50, 100, 'close', 25, 25),
  ('a4900000-0000-4000-8000-000000000006', 'work_change', 1, 100, 80,
    'range', 0, 50, 'different', 50, 100),
  ('a4900000-0000-4000-8000-000000000006', 'customer_contact', 1, 100, 0,
    'range', 0, 50, 'excluded', null, null),
  ('a4900000-0000-4000-8000-000000000006', 'autonomy', 1, 75, 80,
    'known', 50, null, 'close', 25, null);

-- A range never claims to be closer than its far end allows.
select pg_temp.expect_check($$insert into public.match_axis_results
  (match_result_id, axis_key, axis_version, preference, importance, observation_status,
   observed_anchor, observed_anchor_max, comparison_status, difference, difference_max)
  values ('a4900000-0000-4000-8000-000000000006', 'collaboration', 1, 100, 80,
    'range', 50, 100, 'close', 0, 50)$$);
-- difference must be the true nearest-endpoint distance.
select pg_temp.expect_check($insert into public.match_axis_results
  (match_result_id, axis_key, axis_version, preference, importance, observation_status,
   observed_anchor, observed_anchor_max, comparison_status, difference, difference_max)
  values ('a4900000-0000-4000-8000-000000000006', 'collaboration', 1, 70, 80,
    'range', 50, 100, 'partial', 0, 30)$);
select pg_temp.expect_check($$insert into public.match_axis_results
  (match_result_id, axis_key, axis_version, preference, importance, observation_status,
   observed_anchor, observed_anchor_max, comparison_status, difference, difference_max)
  values ('a4900000-0000-4000-8000-000000000006', 'collaboration', 1, 75, 80,
    'range', 50, null, 'close', 0, 25)$$);
-- partial is only for ranges, and known rows have no difference_max.
select pg_temp.expect_check($$insert into public.match_axis_results
  (match_result_id, axis_key, axis_version, preference, importance, observation_status,
   observed_anchor, observed_anchor_max, comparison_status, difference, difference_max)
  values ('a4900000-0000-4000-8000-000000000006', 'collaboration', 1, 75, 80,
    'known', 50, null, 'partial', 25, null)$$);
select pg_temp.expect_check($$insert into public.match_axis_results
  (match_result_id, axis_key, axis_version, preference, importance, observation_status,
   observed_anchor, observed_anchor_max, comparison_status, difference, difference_max)
  values ('a4900000-0000-4000-8000-000000000006', 'collaboration', 1, 75, 80,
    'known', 50, null, 'close', 25, 25)$$);

do $$
declare
  v_match jsonb := public.read_match_result('a4900000-0000-4000-8000-000000000001',
    'a4900000-0000-4000-8000-000000000006');
begin
  if not (v_match -> 'axes') @> '[{"axisKey":"role_breadth","observedAnchor":50,"observedAnchorMax":100,"comparisonStatus":"partial","difference":0,"differenceMax":50}]' then
    raise exception 'read_match_result does not carry the range: %', v_match;
  end if;
end;
$$;

rollback;
