-- Synthetic data only. These rows exercise private, shared, and versioned records.
insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000003101'),
  ('00000000-0000-0000-0000-000000003102');
insert into public.profiles(id, display_name) values
  ('00000000-0000-0000-0000-000000003101', 'Dummy A'),
  ('00000000-0000-0000-0000-000000003102', 'Dummy B');

do $$
declare
  axes jsonb;
  profile jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1, 'preference', 50, 'importance', 50
  ) order by axis_key) into axes
  from public.assessment_axes where axis_version = 1;
  profile := jsonb_build_object(
    'axisCatalogVersion', 1,
    'targetRoles', jsonb_build_array('エンジニア'),
    'axisValues', axes,
    'constraints', jsonb_build_object(
      'minSalaryAmount', null, 'minSalaryCurrency', null,
      'minSalaryPeriod', null, 'fullRemoteRequired', false,
      'allowedPrefectureCodes', jsonb_build_array('13')
    )
  );
  perform public.commit_career_profile(
    '00000000-0000-0000-0000-000000003101', 0,
    '31000000-0000-0000-0000-000000000001', profile);
  perform public.commit_career_profile(
    '00000000-0000-0000-0000-000000003101', 1,
    '31000000-0000-0000-0000-000000000002',
    jsonb_set(profile, '{constraints,fullRemoteRequired}', 'true'));
  perform public.commit_career_profile(
    '00000000-0000-0000-0000-000000003102', 0,
    '31000000-0000-0000-0000-000000000003', profile);
end;
$$;

insert into public.profile_educations
  (id, user_id, institution_name) values
  ('31000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000003101', 'Dummy University');
insert into public.legal_documents
  (id, document_type, version, body_markdown, published_at, effective_at)
values ('31000000-0000-0000-0000-000000000005',
  'terms', 'dummy-v1', '# Dummy terms', now(), now());
insert into public.user_legal_acknowledgements
  (id, user_id, legal_document_id, action)
values ('31000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000003101',
  '31000000-0000-0000-0000-000000000005', 'accepted');
insert into public.companies(id, name) values
  ('31000000-0000-0000-0000-000000000007', 'Dummy Company');
