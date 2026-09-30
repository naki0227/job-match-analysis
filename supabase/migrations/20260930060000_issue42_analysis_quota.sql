-- Issue #42: per-user quota on analyses that need fetching or Jev (new or
-- refreshed URLs). Fresh cache hits are never limited. The window start and
-- limit are runtime settings passed by the API, not constants in SQL.
begin;

-- Append-only: one event per user and URL that needed fetching or Jev within
-- a window. Request rows are overwritten on later cache hits, so they cannot
-- be the quota source without letting users free quota by re-requesting.
create table public.user_analysis_quota_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_url_id uuid not null references public.source_urls(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, created_at, source_url_id)
);
create index user_analysis_quota_events_url_idx
  on public.user_analysis_quota_events (user_id, source_url_id, created_at);

alter table public.user_analysis_quota_events enable row level security;
revoke all on public.user_analysis_quota_events from public, anon, authenticated;
grant select, insert on public.user_analysis_quota_events to service_role;

create function public.request_personal_analysis_limited(
  p_user_id uuid,
  p_raw_url text,
  p_normalized_url text,
  p_analyzer_version text,
  p_fresh_after timestamptz,
  p_quota_since timestamptz,
  p_new_analysis_limit integer
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
  v_request record;
  v_count integer;
begin
  if p_quota_since is null or p_new_analysis_limit is null
    or p_new_analysis_limit < 1 then
    raise exception 'invalid_analysis_quota' using errcode = '22023';
  end if;
  -- One user's requests run one at a time, so parallel calls cannot overshoot.
  perform 1 from public.profiles where id = p_user_id for update;

  select * into v_request from public.request_personal_analysis(
    p_user_id, p_raw_url, p_normalized_url, p_analyzer_version, p_fresh_after
  );
  -- Counting after the request lets the existing RPC decide freshness; a
  -- rejected request raises and rolls back its job, request row and event.
  -- The same URL within the window uses quota once.
  if v_request.job_id is not null then
    insert into public.user_analysis_quota_events (user_id, source_url_id)
    select p_user_id, v_request.source_url_id
    where not exists (
      select 1 from public.user_analysis_quota_events e
      where e.user_id = p_user_id and e.source_url_id = v_request.source_url_id
        and e.created_at >= p_quota_since
    );
    select count(*) into v_count
    from public.user_analysis_quota_events e
    where e.user_id = p_user_id and e.created_at >= p_quota_since;
    if v_count > p_new_analysis_limit then
      raise exception 'analysis_quota_exceeded' using errcode = 'P0429';
    end if;
  end if;

  return query select v_request.request_status::text,
    v_request.source_url_id::uuid, v_request.job_id::uuid,
    v_request.evaluation_id::uuid, v_request.source_fetched_at::timestamptz;
end;
$$;

revoke all on function public.request_personal_analysis_limited(
  uuid, text, text, text, timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.request_personal_analysis_limited(
  uuid, text, text, text, timestamptz, timestamptz, integer
) to service_role;

commit;
