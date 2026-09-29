explain (analyze, buffers)
with latest_per_job as materialized (
  select distinct on (t.job_posting_id)
    t.job_posting_id, m.id, m.created_at
  from public.match_results m
  join public.evaluations e on e.id = m.evaluation_id
  join public.evaluation_targets t on t.id = e.target_id
  where m.user_id = '45000000-0000-4000-8000-000000000001'
    and t.target_type = 'job'
  order by t.job_posting_id, m.created_at desc, m.id desc
)
select * from latest_per_job
order by created_at desc, id desc
limit 21;
