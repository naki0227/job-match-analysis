with axes as (
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1,
    'preference', 50, 'importance', 50
  ) order by axis_key) as value from public.assessment_axes where axis_version = 1
)
select public.commit_career_profile(
  '00000000-0000-0000-0000-000000001621',
  0, :'key'::uuid,
  jsonb_build_object(
    'axisCatalogVersion', 1, 'targetRoles', jsonb_build_array('Engineer'),
    'axisValues', axes.value,
    'constraints', jsonb_build_object(
      'minSalaryAmount', null, 'minSalaryCurrency', null,
      'minSalaryPeriod', null, 'fullRemoteRequired', false,
      'allowedPrefectureCodes', jsonb_build_array()
    )
  )
) from axes;
