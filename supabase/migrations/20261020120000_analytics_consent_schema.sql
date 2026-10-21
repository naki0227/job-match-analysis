-- ADR-043 (Issues #40/#41): analytics consent and the read-only analytics
-- schema. Consent is an append-only history per purpose and policy version,
-- separate from the legal consent of ADR-046 and from operational telemetry.
-- Grafana reads only aggregate views in the analytics schema through the
-- analytics_reader role; it never reads public tables.
begin;

-- Versioned description of each analytics purpose. A grant counts only for
-- the version that is current, so a new version needs a new grant.
create table public.analytics_consent_policies (
  id uuid primary key default gen_random_uuid(),
  purpose text not null
    check (purpose in ('community_benchmark', 'external_aggregate_use')),
  version text not null check (version ~ '^[0-9]+\.[0-9]+$'),
  summary text not null check (
    summary = btrim(summary) and length(summary) between 1 and 4000
  ),
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (purpose, version),
  unique (id, purpose)
);

create table public.analytics_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_id uuid not null,
  purpose text not null,
  action text not null check (action in ('granted', 'withdrawn')),
  recorded_at timestamptz not null default now(),
  foreign key (policy_id, purpose)
    references public.analytics_consent_policies(id, purpose) on delete restrict
);

create index analytics_consent_events_latest
  on public.analytics_consent_events (purpose, user_id, recorded_at desc, id desc);

alter table public.analytics_consent_policies enable row level security;
alter table public.analytics_consent_events enable row level security;
revoke all on public.analytics_consent_policies from public, anon, authenticated;
revoke all on public.analytics_consent_events from public, anon, authenticated;
grant select on public.analytics_consent_policies to service_role;
grant select, insert on public.analytics_consent_events to service_role;

-- The policy version of each purpose in effect at p_at.
create function public.analytics_consent_policies_current_at(p_at timestamptz)
returns table (id uuid, purpose text, version text, summary text, effective_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (p.purpose) p.id, p.purpose, p.version, p.summary, p.effective_at
  from public.analytics_consent_policies p
  where p.effective_at <= p_at
  order by p.purpose, p.effective_at desc, p.id desc;
$$;

-- For each purpose with a current policy: the user's effective decision.
create function public.analytics_consent_status(p_user_id uuid)
returns table (
  purpose text,
  policy_id uuid,
  version text,
  summary text,
  granted boolean,
  recorded_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.purpose, c.id, c.version, c.summary,
    coalesce(l.action = 'granted' and l.policy_id = c.id, false),
    l.recorded_at
  from public.analytics_consent_policies_current_at(now()) c
  left join lateral (
    select e.action, e.policy_id, e.recorded_at
    from public.analytics_consent_events e
    where e.user_id = p_user_id and e.purpose = c.purpose
    order by e.recorded_at desc, e.id desc
    limit 1
  ) l on true
  order by c.purpose;
$$;

-- Records a grant or withdrawal of the current policy of a purpose. Only the
-- current version is accepted, and repeating the effective decision is a
-- no-op, so the history holds changes only.
create function public.record_analytics_consent(
  p_user_id uuid,
  p_policy_id uuid,
  p_action text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purpose text;
  v_current uuid;
  v_last_action text;
  v_last_policy uuid;
begin
  if p_user_id is null or p_policy_id is null
    or p_action is null or p_action not in ('granted', 'withdrawn') then
    raise exception 'invalid_analytics_consent' using errcode = '22023';
  end if;
  select purpose into v_purpose
  from public.analytics_consent_policies where id = p_policy_id;
  if v_purpose is null then
    raise exception 'invalid_analytics_consent' using errcode = '22023';
  end if;
  select id into v_current
  from public.analytics_consent_policies_current_at(now())
  where purpose = v_purpose;
  if v_current is distinct from p_policy_id then
    raise exception 'analytics_policy_outdated' using errcode = 'P0409';
  end if;
  -- Serialize one user's decisions for a purpose.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_purpose, 0));
  select action, policy_id into v_last_action, v_last_policy
  from public.analytics_consent_events
  where user_id = p_user_id and purpose = v_purpose
  order by recorded_at desc, id desc
  limit 1;
  if v_last_action = p_action and v_last_policy = p_policy_id then
    return;
  end if;
  if p_action = 'withdrawn' and (v_last_action is null or v_last_action = 'withdrawn') then
    return;
  end if;
  insert into public.analytics_consent_events(user_id, policy_id, purpose, action)
  values (p_user_id, p_policy_id, v_purpose, p_action);
end;
$$;

revoke all on function public.analytics_consent_policies_current_at(timestamptz)
  from public, anon, authenticated;
revoke all on function public.analytics_consent_status(uuid)
  from public, anon, authenticated;
revoke all on function public.record_analytics_consent(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.analytics_consent_policies_current_at(timestamptz)
  to service_role;
grant execute on function public.analytics_consent_status(uuid) to service_role;
grant execute on function public.record_analytics_consent(uuid, uuid, text)
  to service_role;

-- Aggregates only. Views run as their owner, so analytics_reader needs no
-- privilege on any public table. Never add a view with user ids, profile
-- free text, URLs, or a cohort below analytics.min_cohort_size().
create schema analytics;
revoke all on schema analytics from public;

-- Consent sets as views, not functions: a view's table reads are checked
-- against its owner, while functions called from a view need the caller's
-- privileges. Nobody is granted this schema; it returns user ids.
create schema analytics_private;
revoke all on schema analytics_private from public;

create view analytics_private.current_policies as
select distinct on (p.purpose) p.id, p.purpose, p.version
from public.analytics_consent_policies p
where p.effective_at <= now()
order by p.purpose, p.effective_at desc, p.id desc;

-- Users whose latest decision for a purpose is a grant of the policy
-- version current now. A withdrawal or a newer policy removes them from
-- every aggregate computed afterwards.
create view analytics_private.consented_users as
select l.purpose, l.user_id
from (
  select distinct on (e.purpose, e.user_id) e.purpose, e.user_id, e.policy_id, e.action
  from public.analytics_consent_events e
  where e.recorded_at <= now()
  order by e.purpose, e.user_id, e.recorded_at desc, e.id desc
) l
join analytics_private.current_policies c
  on c.purpose = l.purpose and c.id = l.policy_id
where l.action = 'granted';

-- Smallest cohort any analytics view returns. Internal dashboards only;
-- external use (purpose external_aggregate_use) will need a stricter
-- threshold decided with real data (ADR-043).
create function analytics.min_cohort_size()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;

-- Service usage counts without attributes (no consent needed, ADR-043).
create view analytics.daily_active_users as
select day, count(distinct user_id)::integer as active_users
from (
  select q.user_id, (q.created_at at time zone 'Asia/Tokyo')::date as day
  from public.user_analysis_quota_events q
  union all
  select m.user_id, (m.created_at at time zone 'Asia/Tokyo')::date
  from public.match_results m
) a
group by day;

create view analytics.analysis_usage_daily as
select (q.created_at at time zone 'Asia/Tokyo')::date as day,
  count(*)::integer as new_analyses,
  count(distinct q.user_id)::integer as users
from public.user_analysis_quota_events q
group by 1;

create view analytics.consent_rate as
select c.purpose, c.version,
  (select count(*) from analytics_private.consented_users u
   where u.purpose = c.purpose)::integer as consented_users,
  (select count(*) from public.profiles)::integer as total_users
from analytics_private.current_policies c;

-- Shared evaluation quality (public company data, no personal rows).
create view analytics.unknown_rate_daily as
select (e.created_at at time zone 'Asia/Tokyo')::date as day,
  v.axis_key,
  count(*)::integer as evaluated,
  count(*) filter (where v.observation_status in ('unknown', 'conflicting'))::integer
    as unknown
from public.evaluations e
join public.evaluated_axis_values v on v.evaluation_id = e.id
group by 1, 2;

create view analytics.evaluator_method_daily as
select (e.created_at at time zone 'Asia/Tokyo')::date as day,
  e.evaluator_version,
  count(*)::integer as evaluations
from public.evaluations e
group by 1, 2;

create view analytics.external_api_cost_daily as
select usage_date as day, reserved_units as jev_reserved_units
from public.jev_daily_usage;

-- Consent-scoped (community_benchmark) and thresholded. Companies are public
-- names; a company looked at by fewer users than the threshold is hidden.
create view analytics.company_interest_daily as
select (m.created_at at time zone 'Asia/Tokyo')::date as day,
  co.name as company_name,
  count(distinct m.user_id)::integer as users
from public.match_results m
join analytics_private.consented_users u
  on u.purpose = 'community_benchmark' and u.user_id = m.user_id
join public.evaluations e on e.id = m.evaluation_id
join public.evaluation_targets t on t.id = e.target_id
join public.companies co on co.id = t.company_id
group by 1, 2
having count(distinct m.user_id) >= analytics.min_cohort_size();

-- Cohorts are derived, never searched: graduation year only (the latest
-- ended_on of the user's educations), combined with each user's latest
-- completed CareerProfile version. Cohorts below the threshold are hidden,
-- and no all-users total is published next to them.
create view analytics.cohort_axis_distribution as
with members as (
  select u.user_id,
    (select max(extract(year from ed.ended_on))::integer
     from public.profile_educations ed
     where ed.user_id = u.user_id) as graduation_year,
    (select pv.id from public.career_profile_versions pv
     where pv.user_id = u.user_id and pv.status = 'completed'
     order by pv.version desc limit 1) as profile_version_id
  from analytics_private.consented_users u
  where u.purpose = 'community_benchmark'
)
select m.graduation_year,
  pv.axis_catalog_version,
  av.axis_key,
  count(*)::integer as users,
  round(avg(av.preference), 1) as avg_preference,
  round(avg(av.importance), 1) as avg_importance
from members m
join public.career_profile_versions pv on pv.id = m.profile_version_id
join public.career_profile_axis_values av on av.profile_version_id = pv.id
where m.graduation_year is not null
group by 1, 2, 3
having count(*) >= analytics.min_cohort_size();

-- Read-only role for Grafana's PostgreSQL datasource. The login user is
-- created by the owner outside migrations and granted this role (ADR-043).
create role analytics_reader nologin noinherit;
grant usage on schema analytics to analytics_reader;
grant select on all tables in schema analytics to analytics_reader;
grant execute on function analytics.min_cohort_size() to analytics_reader;
revoke all on all tables in schema analytics from anon, authenticated, service_role;

commit;
