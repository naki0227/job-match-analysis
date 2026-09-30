-- Issue #42 / ADR-042: short-lived abuse signals. Only daily HMAC pseudonyms
-- of the client IP and User-Agent are stored, never raw values. Events are
-- for security review only and are never read by evaluation or matching.
begin;

create table public.abuse_signal_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'analysis_new', 'analysis_quota_rejected',
    'career_profile_saved', 'share_created'
  )),
  -- HMAC-SHA256(secret, UTC date | value); null when the value is untrusted.
  ip_key_day bytea check (octet_length(ip_key_day) = 32),
  ua_key_day bytea check (octet_length(ua_key_day) = 32),
  created_at timestamptz not null default now()
);
create index abuse_signal_events_created_idx
  on public.abuse_signal_events (created_at);
create index abuse_signal_events_ip_idx
  on public.abuse_signal_events (ip_key_day, created_at)
  where ip_key_day is not null;

alter table public.abuse_signal_events enable row level security;
revoke all on public.abuse_signal_events from public, anon, authenticated;
grant select, insert, delete on public.abuse_signal_events to service_role;

create function public.record_abuse_signal(
  p_user_id uuid,
  p_event_type text,
  p_ip_key bytea,
  p_ua_key bytea
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.abuse_signal_events
    (user_id, event_type, ip_key_day, ua_key_day)
  values (p_user_id, p_event_type, p_ip_key, p_ua_key);
  -- ADR-042 retention (7 days), enforced in small batches on every write so
  -- no scheduler is needed.
  delete from public.abuse_signal_events
  where id in (
    select id from public.abuse_signal_events
    where created_at < now() - interval '7 days'
    order by created_at
    limit 1000
  );
end;
$$;

-- Aggregates for review without exposing the pseudonyms themselves.
create function public.abuse_signal_overview(p_since timestamptz)
returns table (
  event_type text,
  events bigint,
  users bigint,
  max_users_per_ip_key bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select e.event_type, e.user_id, e.ip_key_day
    from public.abuse_signal_events e
    where e.created_at >= p_since
  ), per_key as (
    select r.event_type, count(distinct r.user_id) as users
    from recent r
    where r.ip_key_day is not null
    group by r.event_type, r.ip_key_day
  )
  select r.event_type, count(*), count(distinct r.user_id),
    coalesce((select max(k.users) from per_key k
      where k.event_type = r.event_type), 0)
  from recent r
  group by r.event_type
  order by r.event_type;
$$;

revoke all on function public.record_abuse_signal(uuid, text, bytea, bytea)
  from public, anon, authenticated;
grant execute on function public.record_abuse_signal(uuid, text, bytea, bytea)
  to service_role;
revoke all on function public.abuse_signal_overview(timestamptz)
  from public, anon, authenticated;
grant execute on function public.abuse_signal_overview(timestamptz)
  to service_role;

commit;
