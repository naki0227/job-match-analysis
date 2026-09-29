-- Issue #45: analysis history is derived from personal Match results, not bookmarks.
-- Refuse to discard legacy saved rows; they cannot be mapped to an analysis.
begin;

do $$
begin
  if exists (select 1 from public.user_saved_jobs) then
    raise exception 'legacy_saved_jobs_not_empty' using errcode = 'P0001';
  end if;
end;
$$;

create index match_results_history_page_idx
  on public.match_results (user_id, created_at desc, id desc);
drop index public.match_results_user_created_idx;

create function public.list_analysis_history_page(
  p_user_id uuid,
  p_limit integer,
  p_cursor_analyzed_at timestamptz default null,
  p_cursor_match_result_id uuid default null
)
returns table (
  job_posting_id uuid,
  match_result_id uuid,
  analyzed_at timestamptz,
  career_profile_version_id uuid,
  profile_version integer,
  job_title text,
  company_id uuid,
  company_name text,
  job_evaluation_id uuid,
  job_evaluated_at timestamptz,
  company_evaluation_id uuid,
  company_evaluated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 100
    or (p_cursor_analyzed_at is null) <> (p_cursor_match_result_id is null) then
    raise exception 'invalid_analysis_history_page_request' using errcode = '22023';
  end if;

  return query
  with latest_per_job as materialized (
    select distinct on (t.job_posting_id)
      t.job_posting_id, t.company_id, m.id as match_result_id,
      m.created_at as analyzed_at, m.career_profile_version_id,
      m.evaluation_id as job_evaluation_id, e.created_at as job_evaluated_at
    from public.match_results m
    join public.evaluations e on e.id = m.evaluation_id
    join public.evaluation_targets t on t.id = e.target_id
    where m.user_id = p_user_id and t.target_type = 'job'
    order by t.job_posting_id, m.created_at desc, m.id desc
  ), page as materialized (
    select * from latest_per_job h
    where p_cursor_analyzed_at is null
      or (h.analyzed_at, h.match_result_id)
        < (p_cursor_analyzed_at, p_cursor_match_result_id)
    order by h.analyzed_at desc, h.match_result_id desc
    limit p_limit + 1
  )
  select
    page.job_posting_id, page.match_result_id, page.analyzed_at,
    page.career_profile_version_id, v.version, j.title,
    c.id, c.name, page.job_evaluation_id, page.job_evaluated_at,
    ce.id, ce.created_at
  from page
  join public.career_profile_versions v on v.id = page.career_profile_version_id
  join public.job_postings j on j.id = page.job_posting_id
  join public.companies c on c.id = page.company_id
  left join lateral (
    select e.id, e.created_at
    from public.evaluation_targets t
    join public.evaluations e on e.target_id = t.id
    where t.target_type = 'company' and t.company_id = c.id
    order by e.created_at desc, e.id desc
    limit 1
  ) ce on true
  order by page.analyzed_at desc, page.match_result_id desc;
end;
$$;

revoke all on function public.list_analysis_history_page(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_analysis_history_page(uuid, integer, timestamptz, uuid)
  to service_role;

drop function public.list_saved_jobs_page(uuid, integer, timestamptz, uuid);
drop table public.user_saved_jobs;

commit;
