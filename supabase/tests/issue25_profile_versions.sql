-- Issue #25: a confirmed revision creates a new complete snapshot.
begin;

do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000002501';
  v_first_id uuid;
  v_second_id uuid;
  v_first_version integer;
  v_second_version integer;
  v_first_axes jsonb;
  v_second_axes jsonb;
  v_first_payload jsonb;
  v_second_payload jsonb;
begin
  insert into auth.users(id) values (v_user);
  insert into public.profiles(id) values (v_user);
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1, 'preference', 50, 'importance', 50
  ) order by axis_key) into v_first_axes
  from public.assessment_axes where axis_version = 1;
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1, 'preference', 0, 'importance', 100
  ) order by axis_key) into v_second_axes
  from public.assessment_axes where axis_version = 1;
  v_first_payload := jsonb_build_object(
    'axisCatalogVersion', 1, 'targetRoles', jsonb_build_array('エンジニア'),
    'axisValues', v_first_axes,
    'constraints', jsonb_build_object(
      'minSalaryAmount', null, 'minSalaryCurrency', null, 'minSalaryPeriod', null,
      'fullRemoteRequired', false, 'allowedPrefectureCodes', jsonb_build_array('13')
    )
  );
  v_second_payload := jsonb_build_object(
    'axisCatalogVersion', 1, 'targetRoles', jsonb_build_array('デザイナー'),
    'axisValues', v_second_axes,
    'constraints', jsonb_build_object(
      'minSalaryAmount', 5000000, 'minSalaryCurrency', 'JPY',
      'minSalaryPeriod', 'year', 'fullRemoteRequired', true,
      'allowedPrefectureCodes', jsonb_build_array('27')
    )
  );
  select profile_version_id, profile_version into v_first_id, v_first_version
  from public.commit_career_profile(
    v_user, 0, '00000000-0000-0000-0000-000000002502', v_first_payload
  );
  select profile_version_id, profile_version into v_second_id, v_second_version
  from public.commit_career_profile(
    v_user, 1, '00000000-0000-0000-0000-000000002503', v_second_payload
  );
  if v_first_version <> 1 or v_second_version <> 2 or v_first_id = v_second_id
    or (select count(*) from public.career_profile_versions where user_id = v_user) <> 2
    or (select role_text from public.career_profile_target_roles
        where profile_version_id = v_first_id) <> 'エンジニア'
    or (select role_text from public.career_profile_target_roles
        where profile_version_id = v_second_id) <> 'デザイナー'
    or (select count(*) from public.career_profile_axis_values
        where profile_version_id = v_first_id and preference = 50 and importance = 50) <> 8
    or (select count(*) from public.career_profile_axis_values
        where profile_version_id = v_second_id and preference = 0 and importance = 100) <> 8
    or (select min_salary_amount from public.career_constraints
        where profile_version_id = v_first_id) is not null
    or (select min_salary_amount from public.career_constraints
        where profile_version_id = v_second_id) <> 5000000 then
    raise exception 'Completed profile revision mutated or lost a version';
  end if;
end
$$;

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000002504', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.career_profile_versions
      where user_id = '00000000-0000-0000-0000-000000002501')
    or exists (select 1 from public.career_profile_axis_values a
      join public.career_profile_versions v on v.id = a.profile_version_id
      where v.user_id = '00000000-0000-0000-0000-000000002501') then
    raise exception 'Other user can read career profile versions';
  end if;
end
$$;
reset role;
rollback;
