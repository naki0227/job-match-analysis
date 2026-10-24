-- Issue #42 / ADR-039: a loose per-user limit on every analysis request,
-- cache hits included, next to the strict limit on new analyses. Plus the
-- remaining audit signals (ADR-042) and a per-user review summary.
begin;

create table public.user_analysis_request_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index user_analysis_request_events_user_idx
  on public.user_analysis_request_events (user_id, created_at);

alter table public.user_analysis_request_events enable row level security;
revoke all on public.user_analysis_request_events from public, anon, authenticated;
grant select, insert, delete on public.user_analysis_request_events to service_role;

-- Counts this user's requests since p_since and records one more only while
-- under p_limit. Serialized per user so parallel requests cannot overshoot.
-- Rows older than a day are never needed and are trimmed for this user.
create function public.consume_analysis_request_allowance(
  p_user_id uuid,
  p_since timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_user_id is null or p_since is null or p_limit is null or p_limit < 1
    or p_since < now() - interval '1 day' then
    raise exception 'invalid_request_allowance' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('analysis_request:' || p_user_id::text, 0));
  delete from public.user_analysis_request_events
  where user_id = p_user_id and created_at < now() - interval '1 day';
  select count(*) into v_used
  from public.user_analysis_request_events
  where user_id = p_user_id and created_at >= p_since;
  if v_used >= p_limit then
    return false;
  end if;
  insert into public.user_analysis_request_events(user_id) values (p_user_id);
  return true;
end;
$$;

revoke all on function public.consume_analysis_request_allowance(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.consume_analysis_request_allowance(uuid, timestamptz, integer)
  to service_role;

-- Cache hits and request-limit rejections become audit signals too.
alter table public.abuse_signal_events
  drop constraint abuse_signal_events_event_type_check;
alter table public.abuse_signal_events
  add constraint abuse_signal_events_event_type_check check (event_type in (
    'analysis_new', 'analysis_quota_rejected', 'analysis_cached',
    'analysis_rate_limited', 'career_profile_saved', 'share_created'
  ));

-- Security review only (ADR-042): per user since p_since, the signals that
-- point at abuse. Never read by evaluation, matching or analytics. Raw IPs
-- and User-Agents do not exist; only counts of daily pseudonyms are shown.
create function public.abuse_user_signal_summary(p_since timestamptz, p_limit integer)
returns table (
  user_id uuid,
  new_analyses bigint,
  cached_requests bigint,
  quota_rejections bigint,
  rate_limited bigint,
  profile_saves bigint,
  shares_created bigint,
  failed_jobs bigint,
  distinct_ip_keys bigint,
  distinct_ua_keys bigint,
  max_users_sharing_ip_key bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select e.user_id, e.event_type, e.ip_key_day, e.ua_key_day
    from public.abuse_signal_events e
    where e.created_at >= p_since
  ), key_users as (
    select r.ip_key_day, count(distinct r.user_id) as users
    from recent r
    where r.ip_key_day is not null
    group by r.ip_key_day
  ), per_user as (
    select r.user_id,
      count(*) filter (where r.event_type = 'analysis_new') as new_analyses,
      count(*) filter (where r.event_type = 'analysis_cached') as cached_requests,
      count(*) filter (where r.event_type = 'analysis_quota_rejected') as quota_rejections,
      count(*) filter (where r.event_type = 'analysis_rate_limited') as rate_limited,
      count(*) filter (where r.event_type = 'career_profile_saved') as profile_saves,
      count(*) filter (where r.event_type = 'share_created') as shares_created,
      count(distinct r.ip_key_day) as distinct_ip_keys,
      count(distinct r.ua_key_day) as distinct_ua_keys,
      coalesce(max(k.users), 0) as max_users_sharing_ip_key
    from recent r
    left join key_users k on k.ip_key_day = r.ip_key_day
    group by r.user_id
  )
  select p.user_id, p.new_analyses, p.cached_requests, p.quota_rejections,
    p.rate_limited, p.profile_saves, p.shares_created,
    (select count(*) from public.user_analysis_requests ur
     join public.analysis_jobs j on j.id = ur.job_id
     where ur.user_id = p.user_id and ur.requested_at >= p_since
       and j.status = 'failed'),
    p.distinct_ip_keys, p.distinct_ua_keys, p.max_users_sharing_ip_key
  from per_user p
  order by p.max_users_sharing_ip_key desc, p.rate_limited + p.quota_rejections desc,
    p.new_analyses desc, p.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

revoke all on function public.abuse_user_signal_summary(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.abuse_user_signal_summary(timestamptz, integer)
  to service_role;

commit;
