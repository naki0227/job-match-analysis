-- ADR-047: asynchronous web discovery for the Job Resolver. The API only
-- queues a discovery; the crawler worker searches, verifies pages through the
-- safe fetch boundary and stores verified postings in the existing
-- companies / source_urls / job_postings tables. Search results themselves are
-- never stored. No client privileges.
begin;

create table public.job_discovery_requests (
  id uuid primary key default gen_random_uuid(),
  -- Normalized company | role | employment type; the singleflight and cache
  -- key. Search terms only: no user, profile or account data.
  query_key text not null check (length(query_key) between 1 and 300),
  company text not null check (length(btrim(company)) between 1 and 100),
  role_query text check (role_query is null or length(btrim(role_query)) between 1 and 100),
  employment_type text check (employment_type is null or employment_type in (
    'full_time', 'part_time', 'contract', 'intern', 'new_grad')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  worker_token uuid,
  lease_until timestamptz,
  result_count integer check (result_count is null or result_count >= 0),
  error_code text check (error_code is null or error_code in (
    'search_unavailable', 'search_blocked', 'search_timeout', 'internal')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null and result_count is not null))
);
create index job_discovery_requests_key_idx
  on public.job_discovery_requests (query_key, created_at desc);
create index job_discovery_requests_queue_idx
  on public.job_discovery_requests (status, created_at)
  where status in ('queued', 'running');

-- Verified postings a discovery found. They are shared, public job data.
create table public.job_discovery_results (
  request_id uuid not null
    references public.job_discovery_requests(id) on delete cascade,
  job_posting_id uuid not null
    references public.job_postings(id) on delete restrict,
  source_kind text not null check (source_kind in ('official', 'ats', 'web')),
  employment_types jsonb not null default '[]'::jsonb
    check (jsonb_typeof(employment_types) = 'array'),
  location text check (location is null or length(location) <= 300),
  valid_through timestamptz,
  position integer not null check (position >= 0),
  primary key (request_id, job_posting_id)
);

-- Which users may read which discovery: whoever started it, joined it while
-- it ran, or reused its fresh result. Polling is authorized by this row,
-- never by knowing the ID. Removed with the account; the discovery stays.
create table public.job_discovery_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  discovery_id uuid not null
    references public.job_discovery_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, discovery_id)
);
create index job_discovery_access_discovery_idx
  on public.job_discovery_access (discovery_id);

-- Per-user resolver usage for rate limits; removed with the account.
create table public.job_resolver_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('search', 'discovery')),
  created_at timestamptz not null default now()
);
create index job_resolver_events_user_idx
  on public.job_resolver_events (user_id, kind, created_at desc);

alter table public.job_discovery_requests enable row level security;
alter table public.job_discovery_results enable row level security;
alter table public.job_resolver_events enable row level security;
alter table public.job_discovery_access enable row level security;
revoke all on public.job_discovery_requests, public.job_discovery_results,
  public.job_resolver_events, public.job_discovery_access
  from public, anon, authenticated;
grant select, insert on public.job_discovery_access to service_role;
grant select, insert, update, delete on public.job_discovery_requests to service_role;
grant select, insert on public.job_discovery_results to service_role;
grant select, insert, delete on public.job_resolver_events to service_role;

-- Counts one resolver search; P0429 when the user's limit is used up.
create function public.record_job_resolver_search(
  p_user_id uuid, p_since timestamptz, p_limit integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or p_since is null or p_limit is null or p_limit < 1 then
    raise exception 'invalid_resolver_limit' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if (select count(*) from public.job_resolver_events
      where user_id = p_user_id and kind = 'search' and created_at >= p_since)
      >= p_limit then
    raise exception 'job_resolver_rate_limited' using errcode = 'P0429';
  end if;
  insert into public.job_resolver_events(user_id, kind) values (p_user_id, 'search');
  delete from public.job_resolver_events
    where user_id = p_user_id and created_at < p_since;
end;
$$;

-- Reuses a fresh discovery, joins a running one, or queues a new one.
-- P0429: the user's discovery limit is used up. P0503: too many discoveries
-- are already queued service-wide.
create function public.request_job_discovery(
  p_user_id uuid,
  p_query_key text,
  p_company text,
  p_role_query text,
  p_employment_type text,
  p_fresh_after timestamptz,
  p_user_since timestamptz,
  p_user_limit integer,
  p_max_active integer,
  p_retain_after timestamptz
)
returns table (discovery_id uuid, discovery_status text, cached boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if p_user_id is null or p_query_key is null or p_company is null
    or p_fresh_after is null or p_user_since is null or p_retain_after is null
    or p_user_limit is null or p_user_limit < 1
    or p_max_active is null or p_max_active < 1 then
    raise exception 'invalid_job_discovery' using errcode = '22023';
  end if;
  -- One discovery per query at a time, across API replicas.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('job_discovery:' || p_query_key));

  select r.id, r.status into v_id, v_status from public.job_discovery_requests r
    where r.query_key = p_query_key
      and (r.status in ('queued', 'running')
        or (r.status = 'completed' and r.completed_at >= p_fresh_after))
    order by r.created_at desc limit 1;
  if v_id is not null then
    -- Joining a running discovery or reusing a fresh one grants read access.
    insert into public.job_discovery_access(user_id, discovery_id)
      values (p_user_id, v_id) on conflict do nothing;
    return query select v_id, v_status, v_status = 'completed';
    return;
  end if;

  perform 1 from public.profiles where id = p_user_id for update;
  if (select count(*) from public.job_resolver_events
      where user_id = p_user_id and kind = 'discovery' and created_at >= p_user_since)
      >= p_user_limit then
    raise exception 'job_discovery_rate_limited' using errcode = 'P0429';
  end if;
  -- The service-wide cap is checked and used under one global lock, so
  -- different queries started at once on any replica cannot exceed it. It is
  -- always taken after the per-query lock, so the lock order is fixed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('job_discovery:active_cap'));
  if (select count(*) from public.job_discovery_requests
      where status in ('queued', 'running')) >= p_max_active then
    raise exception 'job_discovery_busy' using errcode = 'P0503';
  end if;

  insert into public.job_discovery_requests(query_key, company, role_query, employment_type)
    values (p_query_key, p_company, p_role_query, p_employment_type)
    returning id into v_id;
  insert into public.job_discovery_access(user_id, discovery_id) values (p_user_id, v_id);
  insert into public.job_resolver_events(user_id, kind) values (p_user_id, 'discovery');
  -- Old discoveries are only a cache; the postings they found stay.
  delete from public.job_discovery_requests
    where created_at < p_retain_after and status in ('completed', 'failed');
  return query select v_id, 'queued'::text, false;
end;
$$;

create function public.claim_job_discovery(
  p_worker_token uuid, p_lease_seconds integer, p_max_attempts integer
)
returns table (
  discovery_id uuid, company text, role_query text, employment_type text,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker_token is null or p_lease_seconds is null or p_lease_seconds < 1
    or p_lease_seconds > 3600 or p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'invalid_job_discovery_claim' using errcode = '22023';
  end if;
  -- Expired leases go back to the queue, or fail after the last attempt.
  update public.job_discovery_requests q
    set status = case when q.attempts >= p_max_attempts then 'failed' else 'queued' end,
      error_code = case when q.attempts >= p_max_attempts then 'internal' else q.error_code end,
      worker_token = null, lease_until = null
    where q.status = 'running' and q.lease_until <= pg_catalog.clock_timestamp();
  return query
    with next_request as (
      select r.id from public.job_discovery_requests r
      where r.status = 'queued' and r.attempts < p_max_attempts
      order by r.created_at, r.id
      for update skip locked
      limit 1
    )
    update public.job_discovery_requests r
      set status = 'running', attempts = r.attempts + 1,
        worker_token = p_worker_token,
        lease_until = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_seconds)
      from next_request n where r.id = n.id
      returning r.id, r.company, r.role_query, r.employment_type, r.attempts;
end;
$$;

-- Stores verified postings and completes the discovery. A posting with the
-- same normalized URL, title and employer is reused, exactly as analysis
-- does, so a later analysis of the same URL joins the same posting.
create function public.complete_job_discovery(
  p_discovery_id uuid, p_worker_token uuid, p_results jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_position integer := 0;
  v_source_url_id uuid;
  v_company_id uuid;
  v_posting_id uuid;
begin
  if pg_catalog.jsonb_typeof(p_results) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_results) > 200 then
    raise exception 'invalid_job_discovery_results' using errcode = '22023';
  end if;
  perform 1 from public.job_discovery_requests
    where id = p_discovery_id and status = 'running'
      and worker_token = p_worker_token
      and lease_until > pg_catalog.clock_timestamp()
    for update;
  if not found then
    raise exception 'job_discovery_lease_lost' using errcode = '40001';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_results) loop
    if pg_catalog.length(pg_catalog.btrim(coalesce(v_item ->> 'title', ''))) not between 1 and 300
      or pg_catalog.length(pg_catalog.btrim(coalesce(v_item ->> 'companyName', ''))) not between 1 and 300
      or coalesce(v_item ->> 'url', '') !~ '^https://'
      or pg_catalog.length(v_item ->> 'url') > 2048
      or coalesce(v_item ->> 'sourceKind', '') not in ('official', 'ats', 'web') then
      raise exception 'invalid_job_discovery_result' using errcode = '22023';
    end if;
    insert into public.source_urls(raw_url, normalized_url)
      values (v_item ->> 'url', v_item ->> 'url')
      on conflict (normalized_url) do nothing;
    select id into v_source_url_id from public.source_urls
      where normalized_url = v_item ->> 'url' for update;
    v_posting_id := null;
    select j.id into v_posting_id from public.job_postings j
      join public.companies c on c.id = j.company_id
      where j.source_url_id = v_source_url_id
        and j.title = pg_catalog.btrim(v_item ->> 'title')
        and c.name = pg_catalog.btrim(v_item ->> 'companyName')
      order by j.created_at, j.id limit 1;
    if v_posting_id is null then
      insert into public.companies(name) values (pg_catalog.btrim(v_item ->> 'companyName'))
        returning id into v_company_id;
      insert into public.job_postings(company_id, source_url_id, title)
        values (v_company_id, v_source_url_id, pg_catalog.btrim(v_item ->> 'title'))
        returning id into v_posting_id;
    end if;
    insert into public.job_discovery_results(request_id, job_posting_id, source_kind,
        employment_types, location, valid_through, position)
      values (p_discovery_id, v_posting_id, v_item ->> 'sourceKind',
        coalesce(v_item -> 'employmentTypes', '[]'::jsonb),
        nullif(pg_catalog.left(pg_catalog.btrim(coalesce(v_item ->> 'location', '')), 300), ''),
        (v_item ->> 'validThrough')::timestamptz, v_position)
      on conflict (request_id, job_posting_id) do nothing;
    v_position := v_position + 1;
  end loop;
  update public.job_discovery_requests
    set status = 'completed', worker_token = null, lease_until = null,
      completed_at = pg_catalog.clock_timestamp(),
      result_count = (select count(*) from public.job_discovery_results
        where request_id = p_discovery_id),
      error_code = null
    where id = p_discovery_id;
  return v_position;
end;
$$;

-- A failed search is retried until the attempt limit, then fails.
create function public.fail_job_discovery(
  p_discovery_id uuid, p_worker_token uuid, p_error_code text,
  p_max_attempts integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_error_code not in ('search_unavailable', 'search_blocked', 'search_timeout', 'internal') then
    raise exception 'invalid_job_discovery_error' using errcode = '22023';
  end if;
  update public.job_discovery_requests
    set status = case when attempts >= p_max_attempts then 'failed' else 'queued' end,
      error_code = p_error_code, worker_token = null, lease_until = null
    where id = p_discovery_id and status = 'running' and worker_token = p_worker_token;
  return found;
end;
$$;

-- Status and verified postings of one discovery, for polling by a user who
-- has access to it (nothing otherwise). The stored query is not returned.
create function public.read_job_discovery(p_user_id uuid, p_discovery_id uuid)
returns table (
  discovery_status text, company_name text, title text, url text,
  source_kind text, employment_types jsonb, location text,
  valid_through timestamptz, result_position integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.status, c.name, j.title, s.normalized_url, d.source_kind,
    d.employment_types, d.location, d.valid_through, d.position
  from public.job_discovery_requests r
  left join public.job_discovery_results d on d.request_id = r.id
  left join public.job_postings j on j.id = d.job_posting_id
  left join public.companies c on c.id = j.company_id
  left join public.source_urls s on s.id = j.source_url_id
  where r.id = p_discovery_id
    and exists (select 1 from public.job_discovery_access a
      where a.discovery_id = r.id and a.user_id = p_user_id)
  order by d.position nulls first;
$$;

-- The query a discovery was started for, so polling can finish resolving it.
create function public.read_job_discovery_query(p_user_id uuid, p_discovery_id uuid)
returns table (company text, role_query text, employment_type text, discovery_status text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.company, r.role_query, r.employment_type, r.status
  from public.job_discovery_requests r
  where r.id = p_discovery_id
    and exists (select 1 from public.job_discovery_access a
      where a.discovery_id = r.id and a.user_id = p_user_id);
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.record_job_resolver_search(uuid,timestamptz,integer)',
    'public.request_job_discovery(uuid,text,text,text,text,timestamptz,timestamptz,integer,integer,timestamptz)',
    'public.claim_job_discovery(uuid,integer,integer)',
    'public.complete_job_discovery(uuid,uuid,jsonb)',
    'public.fail_job_discovery(uuid,uuid,text,integer)',
    'public.read_job_discovery(uuid,uuid)',
    'public.read_job_discovery_query(uuid,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

commit;
