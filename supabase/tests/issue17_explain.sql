explain (format json)
select s.job_posting_id, s.created_at, j.title, c.name, je.id, ce.id
from public.user_saved_jobs s
join public.job_postings j on j.id = s.job_posting_id
join public.companies c on c.id = j.company_id
left join lateral (
  select e.id
  from public.evaluation_targets t
  join public.evaluations e on e.target_id = t.id
  where t.target_type = 'job' and t.job_posting_id = j.id
  order by e.created_at desc, e.id desc
  limit 1
) je on true
left join lateral (
  select e.id
  from public.evaluation_targets t
  join public.evaluations e on e.target_id = t.id
  where t.target_type = 'company' and t.company_id = c.id
  order by e.created_at desc, e.id desc
  limit 1
) ce on true
where s.user_id = '00000000-0000-4000-8000-000000001701'
order by s.created_at desc, s.job_posting_id desc
limit 101;
