-- Issue #20: durable, token-guarded claims with bounded retries.
begin;

create function public.reap_analysis_jobs(
  p_max_attempts integer,
  p_limit integer default 100
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 100
    or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid_job_reap_request' using errcode = '22023';
  end if;
  with candidates as (
    select id from public.analysis_jobs
    where (status = 'running'
        and (lease_until is null or lease_until <= pg_catalog.clock_timestamp()))
      or (status = 'queued' and attempts >= p_max_attempts)
    order by created_at, id
    for update skip locked
    limit p_limit
  ), changed as (
    update public.analysis_jobs j
      set status = case when j.attempts >= p_max_attempts
        then 'failed' else 'queued' end,
        worker_token = null, lease_until = null,
        updated_at = pg_catalog.clock_timestamp()
      from candidates c where j.id = c.id
      returning j.id
  ) select count(*) into v_count from changed;
  return v_count;
end;
$$;

create function public.claim_analysis_job(
  p_worker_token uuid,
  p_lease_seconds integer,
  p_max_attempts integer
)
returns table (
  job_id uuid,
  source_url_id uuid,
  analyzer_version text,
  attempts integer,
  lease_until timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker_token is null
    or p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600
    or p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception 'invalid_job_claim_request' using errcode = '22023';
  end if;
  perform public.reap_analysis_jobs(p_max_attempts);
  return query
  with candidate as (
    select j.id from public.analysis_jobs j
    where j.status = 'queued' and j.attempts < p_max_attempts
    order by j.created_at, j.id
    for update skip locked
    limit 1
  )
  update public.analysis_jobs j
    set status = 'running', attempts = j.attempts + 1,
      worker_token = p_worker_token,
      lease_until = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.clock_timestamp()
    from candidate c where j.id = c.id
    returning j.id, j.source_url_id, j.analyzer_version,
      j.attempts, j.lease_until;
end;
$$;

create function public.renew_analysis_job_lease(
  p_job_id uuid,
  p_worker_token uuid,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_job_id is null or p_worker_token is null or p_lease_seconds is null
    or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'invalid_job_renew_request' using errcode = '22023';
  end if;
  update public.analysis_jobs j
    set lease_until = pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.clock_timestamp()
    where j.id = p_job_id and j.status = 'running'
      and j.worker_token = p_worker_token
      and j.lease_until > pg_catalog.clock_timestamp();
  return found;
end;
$$;

create function public.fail_analysis_job(
  p_job_id uuid,
  p_worker_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_job_id is null or p_worker_token is null then
    raise exception 'invalid_job_fail_request' using errcode = '22023';
  end if;
  update public.analysis_jobs j
    set status = 'failed', worker_token = null, lease_until = null,
      updated_at = pg_catalog.clock_timestamp()
    where j.id = p_job_id and j.status = 'running'
      and j.worker_token = p_worker_token
      and j.lease_until > pg_catalog.clock_timestamp();
  return found;
end;
$$;

-- The existing commit_analysis_evaluation RPC checks status/token. Reject
-- completion after lease expiry as well, without editing its old migration.
create function public.require_live_lease_for_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'running' and new.status = 'completed'
    and (old.lease_until is null
      or old.lease_until <= pg_catalog.clock_timestamp()) then
    raise exception 'job_claim_conflict' using errcode = '40001';
  end if;
  return new;
end;
$$;

create trigger analysis_job_live_lease_completion
  before update of status on public.analysis_jobs
  for each row execute function public.require_live_lease_for_completion();

revoke all on function public.reap_analysis_jobs(integer, integer),
  public.claim_analysis_job(uuid, integer, integer),
  public.renew_analysis_job_lease(uuid, uuid, integer),
  public.fail_analysis_job(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.reap_analysis_jobs(integer, integer),
  public.claim_analysis_job(uuid, integer, integer),
  public.renew_analysis_job_lease(uuid, uuid, integer),
  public.fail_analysis_job(uuid, uuid)
to service_role;
revoke all on function public.require_live_lease_for_completion()
from public, anon, authenticated;

commit;
