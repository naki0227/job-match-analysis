-- Issue #19: one serialized registration per normalized URL.
begin;

create index analysis_jobs_completed_lookup_idx
  on public.analysis_jobs (source_url_id, analyzer_version, updated_at desc, id desc)
  where status = 'completed';

create function public.request_analysis(
  p_raw_url text,
  p_normalized_url text,
  p_analyzer_version text,
  p_fresh_after timestamptz
)
returns table (
  request_status text,
  source_url_id uuid,
  job_id uuid,
  evaluation_id uuid,
  source_fetched_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_url_id uuid;
  v_job_id uuid;
  v_evaluation_id uuid;
  v_fetched_at timestamptz;
  v_status text;
begin
  if p_raw_url is null or length(p_raw_url) < 1 or length(p_raw_url) > 2048
    or p_normalized_url is null or length(p_normalized_url) < 1
    or length(p_normalized_url) > 2048 or p_normalized_url !~ '^https://'
    or p_analyzer_version is null or length(btrim(p_analyzer_version)) < 1
    or length(p_analyzer_version) > 120 or p_fresh_after is null then
    raise exception 'invalid_analysis_request' using errcode = '22023';
  end if;

  -- A conflicting insert waits for the winning transaction. Keep the first
  -- raw URL; it is provenance, not a company/job identity or canonical alias.
  insert into public.source_urls(raw_url, normalized_url)
    values (p_raw_url, p_normalized_url)
    on conflict (normalized_url) do nothing;
  select s.id into v_source_url_id
    from public.source_urls s where s.normalized_url = p_normalized_url
    for update;
  if v_source_url_id is null then
    raise exception 'analysis_source_unavailable' using errcode = '40001';
  end if;

  select j.evaluation_id, d.oldest_fetched_at
    into v_evaluation_id, v_fetched_at
    from public.analysis_jobs j
    join lateral (
      select min(sd.fetched_at) as oldest_fetched_at
      from public.evaluation_sources es
      join public.source_document_versions sd
        on sd.id = es.source_document_version_id
      where es.evaluation_id = j.evaluation_id
      having bool_or(sd.source_url_id = v_source_url_id)
    ) d on true
    where j.source_url_id = v_source_url_id
      and j.analyzer_version = p_analyzer_version
      and j.status = 'completed' and j.evaluation_id is not null
    order by (d.oldest_fetched_at >= p_fresh_after) desc,
      j.updated_at desc, j.id desc
    limit 1;

  if v_evaluation_id is not null and v_fetched_at >= p_fresh_after then
    return query select 'fresh'::text, v_source_url_id,
      null::uuid, v_evaluation_id, v_fetched_at;
    return;
  end if;

  select j.id into v_job_id from public.analysis_jobs j
    where j.source_url_id = v_source_url_id
      and j.analyzer_version = p_analyzer_version
      and j.status in ('queued', 'running')
    order by j.created_at, j.id limit 1;
  if v_job_id is null then
    insert into public.analysis_jobs(source_url_id, analyzer_version, status)
      values (v_source_url_id, p_analyzer_version, 'queued')
      returning id into v_job_id;
  end if;

  v_status := case when v_evaluation_id is null then 'queued' else 'stale' end;
  return query select v_status, v_source_url_id, v_job_id,
    v_evaluation_id, v_fetched_at;
end;
$$;

revoke all on function public.request_analysis(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.request_analysis(text, text, text, timestamptz)
  to service_role;

commit;
