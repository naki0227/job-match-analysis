-- Issue #22: establish a job target from explicit JobPosting metadata.
begin;

create function public.resolve_job_evaluation_target(
  p_job_id uuid,
  p_worker_token uuid,
  p_title text,
  p_employer_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_url_id uuid;
  v_posting_id uuid;
  v_company_id uuid;
  v_target_id uuid;
begin
  if p_job_id is null or p_worker_token is null
    or p_title is null or length(btrim(p_title)) < 1 or length(p_title) > 300
    or p_employer_name is null or length(btrim(p_employer_name)) < 1
    or length(p_employer_name) > 300 then
    raise exception 'invalid_job_identity' using errcode = '22023';
  end if;

  select j.source_url_id into v_source_url_id
    from public.analysis_jobs j
    where j.id = p_job_id and j.status = 'running'
      and j.worker_token = p_worker_token
      and j.lease_until > pg_catalog.clock_timestamp()
    for update;
  if v_source_url_id is null then
    raise exception 'analysis_job_lease_lost' using errcode = '40001';
  end if;

  -- The source URL is the serialization key, not a claim that two URLs
  -- identify the same employer. A changed title/employer gets a new target.
  perform 1 from public.source_urls where id = v_source_url_id for update;
  select j.id, j.company_id into v_posting_id, v_company_id
    from public.job_postings j
    join public.companies c on c.id = j.company_id
    where j.source_url_id = v_source_url_id
      and j.title = p_title and c.name = p_employer_name
    order by j.created_at, j.id
    limit 1;

  if v_posting_id is null then
    insert into public.companies(name) values (p_employer_name)
      returning id into v_company_id;
    insert into public.job_postings(company_id, source_url_id, title)
      values (v_company_id, v_source_url_id, p_title)
      returning id into v_posting_id;
  end if;

  select t.id into v_target_id from public.evaluation_targets t
    where t.target_type = 'job' and t.job_posting_id = v_posting_id;
  if v_target_id is null then
    insert into public.evaluation_targets(target_type, company_id, job_posting_id)
      values ('job', v_company_id, v_posting_id)
      returning id into v_target_id;
  end if;
  return v_target_id;
end;
$$;

revoke all on function public.resolve_job_evaluation_target(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_job_evaluation_target(uuid, uuid, text, text)
  to service_role;

commit;
