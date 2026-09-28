do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000001601';
  v_key uuid := '00000000-0000-0000-0000-000000001602';
  v_payload jsonb;
  v_id uuid;
  v_version integer;
  v_axes jsonb;
begin
  insert into auth.users(id) values (v_user);
  insert into public.profiles(id) values (v_user);
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1, 'preference', 50, 'importance', 50
  ) order by axis_key) into v_axes from public.assessment_axes where axis_version = 1;
  v_payload := jsonb_build_object(
    'axisCatalogVersion', 1, 'targetRoles', jsonb_build_array('エンジニア'),
    'axisValues', v_axes,
    'constraints', jsonb_build_object(
      'minSalaryAmount', null, 'minSalaryCurrency', null, 'minSalaryPeriod', null,
      'fullRemoteRequired', false, 'allowedPrefectureCodes', jsonb_build_array('13')
    )
  );
  select profile_version_id, profile_version into v_id, v_version
  from public.commit_career_profile(v_user, 0, v_key, v_payload);
  if v_version <> 1 or
    (select count(*) from public.career_profile_axis_values where profile_version_id = v_id) <> 8 or
    (select count(*) from public.career_profile_target_roles where profile_version_id = v_id) <> 1 or
    (select count(*) from public.career_constraint_locations where profile_version_id = v_id) <> 1 then
    raise exception 'profile children incomplete';
  end if;
  perform public.commit_career_profile(v_user, 0, v_key, v_payload);
  if (select count(*) from public.career_profile_versions where user_id = v_user) <> 1 then
    raise exception 'idempotent retry duplicated version';
  end if;
  begin
    perform public.commit_career_profile(v_user, 0,
      '00000000-0000-0000-0000-000000001603', v_payload);
    raise exception 'expected stale version rejection';
  exception when serialization_failure then null;
  end;
  begin
    perform public.commit_career_profile(v_user, 0, v_key,
      jsonb_set(v_payload, '{constraints,fullRemoteRequired}', 'true'));
    raise exception 'expected payload mismatch';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.commit_career_profile(v_user, 1,
      '00000000-0000-0000-0000-000000001604',
      jsonb_set(v_payload, '{targetRoles}', '[]'));
    raise exception 'expected invalid role rejection';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.career_profile_versions where user_id = v_user) <> 1 then
    raise exception 'failed transaction left a version';
  end if;
end
$$;

do $$
begin
  if has_function_privilege('anon',
    'public.commit_career_profile(uuid,integer,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated',
    'public.commit_career_profile(uuid,integer,uuid,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role',
    'public.commit_career_profile(uuid,integer,uuid,jsonb)', 'EXECUTE') then
    raise exception 'profile RPC privilege mismatch';
  end if;
end
$$;
