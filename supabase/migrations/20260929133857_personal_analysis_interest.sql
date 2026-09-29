-- Issue #27: record the authenticated request without exposing it through shared jobs.
begin;

create table public.user_analysis_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_url_id uuid not null references public.source_urls(id) on delete restrict,
  job_id uuid references public.analysis_jobs(id) on delete restrict,
  requested_evaluation_id uuid references public.evaluations(id) on delete restrict,
  requested_at timestamptz not null default now(),
  primary key (user_id, source_url_id),
  check (job_id is not null or requested_evaluation_id is not null)
);

create index user_analysis_requests_job_idx on public.user_analysis_requests(job_id)
  where job_id is not null;

alter table public.user_analysis_requests enable row level security;
revoke all on public.user_analysis_requests from public, anon, authenticated;
grant select, insert, update on public.user_analysis_requests to service_role;

create function public.request_personal_analysis(
  p_user_id uuid,
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
  v_request record;
begin
  if p_user_id is null or not exists (
    select 1 from public.profiles where id = p_user_id
  ) then
    raise exception 'invalid_personal_analysis_user' using errcode = '22023';
  end if;
  select * into v_request from public.request_analysis(
    p_raw_url, p_normalized_url, p_analyzer_version, p_fresh_after
  );
  insert into public.user_analysis_requests (
    user_id, source_url_id, job_id, requested_evaluation_id
  ) values (
    p_user_id, v_request.source_url_id, v_request.job_id, v_request.evaluation_id
  )
  on conflict on constraint user_analysis_requests_pkey do update set
    job_id = excluded.job_id,
    requested_evaluation_id = excluded.requested_evaluation_id,
    requested_at = now();
  return query select v_request.request_status::text,
    v_request.source_url_id::uuid, v_request.job_id::uuid,
    v_request.evaluation_id::uuid, v_request.source_fetched_at::timestamptz;
end;
$$;

create function public.list_unmatched_analysis_evaluations(
  p_user_id uuid,
  p_limit integer
)
returns table (evaluation_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_unmatched_analysis_request' using errcode = '22023';
  end if;
  return query
  select distinct on (r.requested_at, r.source_url_id)
    coalesce(j.evaluation_id, r.requested_evaluation_id) as evaluation_id
  from public.user_analysis_requests r
  left join public.analysis_jobs j on j.id = r.job_id
  where r.user_id = p_user_id
    and coalesce(j.evaluation_id, r.requested_evaluation_id) is not null
    and not exists (
      select 1 from public.match_results m
      where m.user_id = p_user_id
        and m.evaluation_id = coalesce(j.evaluation_id, r.requested_evaluation_id)
    )
  order by r.requested_at, r.source_url_id
  limit p_limit;
end;
$$;

revoke all on function public.request_personal_analysis(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.request_personal_analysis(uuid, text, text, text, timestamptz)
  to service_role;
revoke all on function public.list_unmatched_analysis_evaluations(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_unmatched_analysis_evaluations(uuid, integer)
  to service_role;

commit;
