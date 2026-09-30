-- Issue #43: provenance and typed, versioned job facts are committed with the evaluation.
begin;
alter table public.evaluated_axis_values
  add column evaluation_method text not null default 'jev'
  check (evaluation_method in ('deterministic', 'rule', 'jev'));

create table public.evaluation_job_facts (
  evaluation_id uuid not null references public.evaluations(id) on delete restrict,
  kind text not null check (kind in (
    'salary', 'location', 'fullRemote', 'weeklyOfficeDays',
    'scheduleFlexibility', 'targetRole', 'techStack'
  )),
  payload jsonb not null check (
    pg_catalog.jsonb_typeof(payload) = 'object'
    and payload ->> 'status' in ('known', 'unknown', 'conflicting')
    and ((payload ->> 'status' = 'known'
      and payload ? 'value'
      and pg_catalog.jsonb_typeof(payload -> 'excerpt') = 'string'
      and pg_catalog.jsonb_typeof(payload -> 'locator') = 'string')
      or (payload ->> 'status' <> 'known'
        and not (payload ? 'value' or payload ? 'excerpt' or payload ? 'locator')))
  ),
  primary key (evaluation_id, kind)
);
alter table public.evaluation_job_facts enable row level security;
revoke all on public.evaluation_job_facts from public, anon, authenticated;
grant select, insert on public.evaluation_job_facts to service_role;

create function public.commit_analysis_evaluation_v2(
  p_job_id uuid, p_worker_token uuid, p_target_id uuid,
  p_documents jsonb, p_evaluation jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job_status text;
  v_existing_id uuid;
  v_evaluation_id uuid;
  v_expected_methods jsonb;
  v_stored_methods jsonb;
  v_expected_facts jsonb := coalesce(p_evaluation -> 'jobFacts', 'null'::jsonb);
  v_stored_facts jsonb;
  v_fact record;
begin
  if p_job_id is null or p_worker_token is null or p_target_id is null
    or pg_catalog.jsonb_typeof(p_evaluation -> 'axisValues') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_expected_facts) not in ('object', 'null') then
    raise exception 'invalid_evaluation_request' using errcode = '22023';
  end if;
  select status into v_job_status from public.analysis_jobs
    where id = p_job_id for update;
  if v_job_status = 'completed' then
    return public.commit_analysis_evaluation(
      p_job_id, p_worker_token, p_target_id, p_documents, p_evaluation
    );
  end if;
  select pg_catalog.jsonb_object_agg(item ->> 'axisKey', item ->> 'evaluationMethod')
    into v_expected_methods
    from pg_catalog.jsonb_array_elements(p_evaluation -> 'axisValues') item;
  if v_expected_methods is null
    or (select count(*) from pg_catalog.jsonb_array_elements(p_evaluation -> 'axisValues')) <> 8
    or (select count(*) from pg_catalog.jsonb_object_keys(v_expected_methods)) <> 8
    or exists (select 1 from pg_catalog.jsonb_each_text(v_expected_methods) m
      where m.value not in ('deterministic', 'rule', 'jev') or m.value is null) then
    raise exception 'invalid_evaluation_method' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_expected_facts) = 'object' then
    for v_fact in select key, value from pg_catalog.jsonb_each(v_expected_facts) loop
      if v_fact.key not in ('salary', 'location', 'fullRemote',
          'weeklyOfficeDays', 'scheduleFlexibility', 'targetRole', 'techStack')
        or pg_catalog.jsonb_typeof(v_fact.value) is distinct from 'object'
        or v_fact.value ->> 'status' not in ('known', 'unknown', 'conflicting') then
        raise exception 'invalid_job_fact' using errcode = '22023';
      end if;
    end loop;
  end if;
  -- Match the lock order of the original RPC: job, then target.
  perform 1 from public.evaluation_targets where id = p_target_id for update;
  select id into v_existing_id from public.evaluations
    where target_id = p_target_id
      and source_set_hash = p_evaluation ->> 'sourceSetHash'
      and rubric_version = p_evaluation ->> 'rubricVersion'
      and evaluator_version = p_evaluation ->> 'evaluatorVersion'
      and model_version = p_evaluation ->> 'modelVersion';
  v_evaluation_id := public.commit_analysis_evaluation(
    p_job_id, p_worker_token, p_target_id, p_documents, p_evaluation
  );
  if v_existing_id is null then
    update public.evaluated_axis_values a
      set evaluation_method = x."evaluationMethod"
      from pg_catalog.jsonb_to_recordset(p_evaluation -> 'axisValues')
        as x("axisKey" text, "evaluationMethod" text)
      where a.evaluation_id = v_evaluation_id and a.axis_key = x."axisKey";
    if pg_catalog.jsonb_typeof(v_expected_facts) = 'object' then
      insert into public.evaluation_job_facts(evaluation_id, kind, payload)
        select v_evaluation_id, key, value
        from pg_catalog.jsonb_each(v_expected_facts);
    end if;
  else
    select pg_catalog.jsonb_object_agg(a.axis_key, a.evaluation_method)
      into v_stored_methods from public.evaluated_axis_values a
      where a.evaluation_id = v_evaluation_id;
    select coalesce(pg_catalog.jsonb_object_agg(f.kind, f.payload), 'null'::jsonb)
      into v_stored_facts from public.evaluation_job_facts f
      where f.evaluation_id = v_evaluation_id;
    if v_stored_methods is distinct from v_expected_methods
      or v_stored_facts is distinct from v_expected_facts then
      raise exception 'evaluation_payload_conflict' using errcode = '22023';
    end if;
  end if;
  return v_evaluation_id;
end;
$$;

revoke all on function public.commit_analysis_evaluation_v2(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_analysis_evaluation_v2(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;
commit;
