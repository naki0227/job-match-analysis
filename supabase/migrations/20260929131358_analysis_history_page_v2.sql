-- Issue #27: one filtered, keyset-paginated read of the caller's latest Match per job.
begin;

create function public.list_analysis_history_page_v2(
  p_user_id uuid,
  p_limit integer,
  p_fresh_after timestamptz,
  p_role text default null,
  p_judgement text default 'all',
  p_sort text default 'recent',
  p_cursor_sort_count integer default null,
  p_cursor_analyzed_at timestamptz default null,
  p_cursor_match_result_id uuid default null
)
returns table (
  job_posting_id uuid,
  match_result_id uuid,
  analyzed_at timestamptz,
  career_profile_version_id uuid,
  profile_version integer,
  target_roles text[],
  job_title text,
  company_id uuid,
  company_name text,
  job_evaluation_id uuid,
  job_evaluated_at timestamptz,
  company_evaluation_id uuid,
  company_evaluated_at timestamptz,
  close_count integer,
  different_count integer,
  unknown_count integer,
  stale_conditions boolean,
  sort_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 100
    or p_fresh_after is null
    or (p_role is not null and (
      length(p_role) < 1 or length(p_role) > 512 or p_role <> btrim(p_role)
    ))
    or p_judgement is null
    or p_judgement not in ('all', 'mostly_close', 'has_different', 'has_unknown')
    or p_sort is null
    or p_sort not in ('recent', 'close', 'fewest_unknown')
    or (p_cursor_sort_count is null) <> (p_cursor_analyzed_at is null)
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
  ), enriched as materialized (
    select
      h.*, v.version as profile_version, j.title as job_title,
      c.name as company_name, roles.target_roles,
      counts.close_count, counts.different_count, counts.unknown_count,
      (coalesce(constraints.has_stale_condition, false)
        or (sources.oldest_fetched_at is not null
          and sources.oldest_fetched_at < p_fresh_after)) as stale_conditions,
      case p_sort
        when 'close' then counts.close_count
        when 'fewest_unknown' then -counts.unknown_count
        else 0
      end as sort_count
    from latest_per_job h
    join public.career_profile_versions v on v.id = h.career_profile_version_id
    join public.job_postings j on j.id = h.job_posting_id
    join public.companies c on c.id = h.company_id
    cross join lateral (
      select coalesce(array_agg(r.role_text order by r.role_order), array[]::text[])
        as target_roles
      from public.career_profile_target_roles r
      where r.profile_version_id = h.career_profile_version_id
    ) roles
    cross join lateral (
      select
        count(*) filter (where a.comparison_status = 'close')::integer as close_count,
        count(*) filter (where a.comparison_status = 'different')::integer as different_count,
        count(*) filter (where a.comparison_status in ('unknown', 'conflicting', 'stale'))::integer
          as unknown_count
      from public.match_axis_results a
      where a.match_result_id = h.match_result_id
    ) counts
    cross join lateral (
      select bool_or(cr.reason = 'stale_information') as has_stale_condition
      from public.match_constraint_results cr
      where cr.match_result_id = h.match_result_id
    ) constraints
    cross join lateral (
      select min(sd.fetched_at) as oldest_fetched_at
      from public.evaluation_sources es
      join public.source_document_versions sd
        on sd.id = es.source_document_version_id
      where es.evaluation_id = h.job_evaluation_id
    ) sources
  ), page as materialized (
    select e.* from enriched e
    where (p_role is null or p_role = any(e.target_roles))
      and (p_judgement = 'all'
        or (p_judgement = 'mostly_close' and e.close_count > e.different_count)
        or (p_judgement = 'has_different' and e.different_count > 0)
        or (p_judgement = 'has_unknown' and e.unknown_count > 0))
      and (p_cursor_analyzed_at is null
        or (e.sort_count, e.analyzed_at, e.match_result_id)
          < (p_cursor_sort_count, p_cursor_analyzed_at, p_cursor_match_result_id))
    order by e.sort_count desc, e.analyzed_at desc, e.match_result_id desc
    limit p_limit + 1
  )
  select
    page.job_posting_id, page.match_result_id, page.analyzed_at,
    page.career_profile_version_id, page.profile_version, page.target_roles,
    page.job_title, page.company_id, page.company_name,
    page.job_evaluation_id, page.job_evaluated_at,
    ce.id, ce.created_at,
    page.close_count, page.different_count, page.unknown_count,
    page.stale_conditions, page.sort_count
  from page
  left join lateral (
    select e.id, e.created_at
    from public.evaluation_targets t
    join public.evaluations e on e.target_id = t.id
    where t.target_type = 'company' and t.company_id = page.company_id
    order by e.created_at desc, e.id desc
    limit 1
  ) ce on true
  order by page.sort_count desc, page.analyzed_at desc, page.match_result_id desc;
end;
$$;

revoke all on function public.list_analysis_history_page_v2(
  uuid, integer, timestamptz, text, text, text, integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.list_analysis_history_page_v2(
  uuid, integer, timestamptz, text, text, text, integer, timestamptz, uuid
) to service_role;

commit;
