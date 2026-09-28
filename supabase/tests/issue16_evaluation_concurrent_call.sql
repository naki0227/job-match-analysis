with axes as (
  select jsonb_agg(jsonb_build_object(
    'axisKey', axis_key, 'axisVersion', 1,
    'observationStatus', 'unknown', 'anchorValue', null
  ) order by axis_key) as value from public.assessment_axes where axis_version = 1
)
select public.commit_analysis_evaluation(
  :'job_id'::uuid, :'worker_token'::uuid,
  '00000000-0000-0000-0000-000000001624',
  jsonb_build_array(jsonb_build_object(
    'sourceUrlId', '00000000-0000-0000-0000-000000001622',
    'contentHash', 'concurrent-hash',
    'fetchedAt', '2026-09-28T00:00:00Z',
    'extractorVersion', 'v1', 'extractedText', 'concurrent source'
  )),
  jsonb_build_object(
    'axisCatalogVersion', 1, 'sourceSetHash', 'concurrent-set',
    'rubricVersion', 'r1', 'evaluatorVersion', 'e1', 'modelVersion', 'm1',
    'axisValues', axes.value, 'evidence', jsonb_build_array()
  )
) from axes;
