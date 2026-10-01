-- Release transient analysis failures immediately instead of leaving them
-- "running" until the lease expires. The attempt count is preserved, so the
-- next claim still respects CRAWLER_MAX_ATTEMPTS.
begin;

create function public.requeue_analysis_job(
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
    raise exception 'invalid_job_requeue_request' using errcode = '22023';
  end if;

  update public.analysis_jobs j
    set status = 'queued',
        worker_token = null,
        lease_until = null,
        updated_at = pg_catalog.clock_timestamp()
    where j.id = p_job_id
      and j.status = 'running'
      and j.worker_token = p_worker_token
      and j.lease_until > pg_catalog.clock_timestamp();

  return found;
end;
$$;

revoke all on function public.requeue_analysis_job(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.requeue_analysis_job(uuid, uuid)
to service_role;

commit;
