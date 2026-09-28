-- Issue #16: one completed profile version and all its children in one RPC call.
-- Nullable for versions that predate this migration; every new RPC write supplies it.
alter table public.career_profile_versions
  add column idempotency_key uuid;

alter table public.career_profile_versions
  add constraint career_profile_versions_user_idempotency_unique
  unique (user_id, idempotency_key);

create function public.commit_career_profile(
  p_user_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_profile jsonb
)
returns table (profile_version_id uuid, profile_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_catalog_version integer;
  v_roles jsonb;
  v_axes jsonb;
  v_constraints jsonb;
  v_locations jsonb;
  v_item jsonb;
  v_request jsonb;
  v_stored jsonb;
  v_existing_id uuid;
  v_existing_version integer;
  v_latest_version integer;
  v_new_id uuid;
  v_catalog_axes integer;
begin
  if p_user_id is null or p_idempotency_key is null
    or p_expected_version is null or p_expected_version < 0
    or pg_catalog.jsonb_typeof(p_profile) <> 'object' then
    raise exception 'invalid_profile_request' using errcode = '22023';
  end if;

  v_catalog_version := (p_profile ->> 'axisCatalogVersion')::integer;
  v_roles := p_profile -> 'targetRoles';
  v_axes := p_profile -> 'axisValues';
  v_constraints := p_profile -> 'constraints';
  v_locations := v_constraints -> 'allowedPrefectureCodes';
  if v_catalog_version is null or v_catalog_version <= 0
    or pg_catalog.jsonb_typeof(v_roles) <> 'array'
    or pg_catalog.jsonb_array_length(v_roles) = 0
    or pg_catalog.jsonb_typeof(v_axes) <> 'array'
    or pg_catalog.jsonb_array_length(v_axes) <> 8
    or pg_catalog.jsonb_typeof(v_constraints) <> 'object'
    or pg_catalog.jsonb_typeof(v_locations) <> 'array'
    or pg_catalog.jsonb_typeof(v_constraints -> 'fullRemoteRequired') <> 'boolean' then
    raise exception 'invalid_profile_request' using errcode = '22023';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_roles) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'string' then
      raise exception 'invalid_target_role' using errcode = '22023';
    end if;
  end loop;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_locations) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'string' then
      raise exception 'invalid_prefecture_code' using errcode = '22023';
    end if;
  end loop;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_axes) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
      or pg_catalog.jsonb_typeof(v_item -> 'axisKey') <> 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'axisVersion') <> 'number'
      or pg_catalog.jsonb_typeof(v_item -> 'preference') <> 'number'
      or pg_catalog.jsonb_typeof(v_item -> 'importance') <> 'number'
      or (v_item ->> 'axisVersion') !~ '^[0-9]+$'
      or (v_item ->> 'preference') !~ '^[0-9]+$'
      or (v_item ->> 'importance') !~ '^[0-9]+$' then
      raise exception 'invalid_axis_value' using errcode = '22023';
    end if;
  end loop;

  v_request := pg_catalog.jsonb_build_object(
    'axisCatalogVersion', v_catalog_version,
    'targetRoles', v_roles,
    'axisValues', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'axisKey', x."axisKey", 'axisVersion', x."axisVersion",
          'preference', x.preference, 'importance', x.importance
        ) order by x."axisKey"
      )
      from pg_catalog.jsonb_to_recordset(v_axes) as x(
        "axisKey" text, "axisVersion" integer,
        preference smallint, importance smallint
      )
    ),
    'constraints', pg_catalog.jsonb_build_object(
      'minSalaryAmount', (v_constraints ->> 'minSalaryAmount')::bigint,
      'minSalaryCurrency', v_constraints ->> 'minSalaryCurrency',
      'minSalaryPeriod', v_constraints ->> 'minSalaryPeriod',
      'fullRemoteRequired', (v_constraints ->> 'fullRemoteRequired')::boolean,
      'allowedPrefectureCodes', (
        select coalesce(
          pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x.value) order by x.value),
          '[]'::jsonb
        )
        from pg_catalog.jsonb_array_elements_text(v_locations) as x(value)
      )
    )
  );

  -- The permanent user row serializes version allocation across requests.
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'profile_owner_missing' using errcode = '23503';
  end if;

  select id, version into v_existing_id, v_existing_version
  from public.career_profile_versions
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    select pg_catalog.jsonb_build_object(
      'axisCatalogVersion', pv.axis_catalog_version,
      'targetRoles', (
        select pg_catalog.jsonb_agg(r.role_text order by r.role_order)
        from public.career_profile_target_roles r
        where r.profile_version_id = pv.id
      ),
      'axisValues', (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'axisKey', a.axis_key, 'axisVersion', a.axis_version,
            'preference', a.preference, 'importance', a.importance
          ) order by a.axis_key
        )
        from public.career_profile_axis_values a
        where a.profile_version_id = pv.id
      ),
      'constraints', (
        select pg_catalog.jsonb_build_object(
          'minSalaryAmount', c.min_salary_amount,
          'minSalaryCurrency', c.min_salary_currency,
          'minSalaryPeriod', c.min_salary_period,
          'fullRemoteRequired', c.full_remote_required,
          'allowedPrefectureCodes', (
            select coalesce(
              pg_catalog.jsonb_agg(l.prefecture_code order by l.prefecture_code),
              '[]'::jsonb
            )
            from public.career_constraint_locations l
            where l.profile_version_id = pv.id
          )
        )
        from public.career_constraints c
        where c.profile_version_id = pv.id
      )
    ) into v_stored
    from public.career_profile_versions pv
    where pv.id = v_existing_id and pv.status = 'completed';
    if v_stored is distinct from v_request then
      raise exception 'idempotency_payload_mismatch' using errcode = '22023';
    end if;
    return query select v_existing_id, v_existing_version;
    return;
  end if;

  select coalesce(pg_catalog.max(version), 0) into v_latest_version
  from public.career_profile_versions where user_id = p_user_id;
  if v_latest_version <> p_expected_version then
    raise exception 'profile_version_conflict' using errcode = '40001';
  end if;

  insert into public.career_profile_versions (
    user_id, version, axis_catalog_version, status, idempotency_key
  ) values (
    p_user_id, v_latest_version + 1, v_catalog_version, 'completed', p_idempotency_key
  ) returning id into v_new_id;

  insert into public.career_profile_target_roles (profile_version_id, role_order, role_text)
  select v_new_id, (x.ordinality - 1)::integer, x.value #>> '{}'
  from pg_catalog.jsonb_array_elements(v_roles) with ordinality as x(value, ordinality);

  insert into public.career_profile_axis_values (
    profile_version_id, axis_key, axis_version, preference, importance
  )
  select v_new_id, x."axisKey", x."axisVersion", x.preference, x.importance
  from pg_catalog.jsonb_to_recordset(v_axes) as x(
    "axisKey" text, "axisVersion" integer,
    preference smallint, importance smallint
  );

  select count(*) into v_catalog_axes from public.assessment_axes
  where axis_version = v_catalog_version;
  if v_catalog_axes <> 8 then
    raise exception 'unsupported_axis_catalog' using errcode = '22023';
  end if;

  insert into public.career_constraints (
    profile_version_id, min_salary_amount, min_salary_currency,
    min_salary_period, full_remote_required
  ) values (
    v_new_id, (v_constraints ->> 'minSalaryAmount')::bigint,
    v_constraints ->> 'minSalaryCurrency',
    v_constraints ->> 'minSalaryPeriod',
    (v_constraints ->> 'fullRemoteRequired')::boolean
  );

  insert into public.career_constraint_locations (profile_version_id, prefecture_code)
  select v_new_id, x.value
  from pg_catalog.jsonb_array_elements_text(v_locations) as x(value);

  return query select v_new_id, v_latest_version + 1;
end;
$$;

revoke all on function public.commit_career_profile(uuid, integer, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_career_profile(uuid, integer, uuid, jsonb)
  to service_role;
