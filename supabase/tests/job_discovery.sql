-- ADR-047: queued web discovery with cache, singleflight and rate limits.
begin;
insert into auth.users(id) values
  ('47000000-0000-4000-8000-000000000001'), ('47000000-0000-4000-8000-000000000002'),
  ('47000000-0000-4000-8000-000000000003');
insert into public.profiles(id) values
  ('47000000-0000-4000-8000-000000000001'), ('47000000-0000-4000-8000-000000000002'),
  ('47000000-0000-4000-8000-000000000003');

set local role service_role;
do $$
declare
  v_alice uuid := '47000000-0000-4000-8000-000000000001';
  v_bob uuid := '47000000-0000-4000-8000-000000000002';
  v_first record;
  v_again record;
  v_claim record;
  v_token uuid := gen_random_uuid();
  v_count integer;
  v_old timestamptz := now() - interval '1 day';
begin
  -- Search limit per user.
  perform public.record_job_resolver_search(v_alice, v_old, 2);
  perform public.record_job_resolver_search(v_alice, v_old, 2);
  begin
    perform public.record_job_resolver_search(v_alice, v_old, 2);
    raise exception 'search limit not enforced';
  exception when sqlstate 'P0429' then null;
  end;
  perform public.record_job_resolver_search(v_bob, v_old, 2);

  -- First request queues; a second user with the same query joins it.
  select * into v_first from public.request_job_discovery(v_alice, 'sample|backend|',
    'サンプル', 'backend', null, now() - interval '1 hour', v_old, 1, 5, v_old);
  -- Knowing the ID is not access: Bob cannot read Alice's discovery yet.
  if exists (select 1 from public.read_job_discovery(v_bob, v_first.discovery_id))
    or exists (select 1 from public.read_job_discovery_query(v_bob, v_first.discovery_id))
    or not exists (select 1 from public.read_job_discovery(v_alice, v_first.discovery_id)) then
    raise exception 'discovery access is not per user';
  end if;
  select * into v_again from public.request_job_discovery(v_bob, 'sample|backend|',
    'サンプル', 'backend', null, now() - interval '1 hour', v_old, 1, 5, v_old);
  if v_first.discovery_status <> 'queued' or v_first.cached
    or v_again.discovery_id <> v_first.discovery_id or v_again.cached then
    raise exception 'singleflight failed: % %', v_first, v_again;
  end if;
  if (select count(*) from public.job_resolver_events
      where kind = 'discovery') <> 1 then
    raise exception 'joining a running discovery counted against the limit';
  end if;
  if not exists (select 1 from public.read_job_discovery_query(v_bob, v_first.discovery_id)) then
    raise exception 'joining did not grant access';
  end if;
  -- Alice's discovery limit (1) is used up for a different query.
  begin
    perform public.request_job_discovery(v_alice, 'other||', 'Other', null, null,
      now() - interval '1 hour', v_old, 1, 5, v_old);
    raise exception 'discovery limit not enforced';
  exception when sqlstate 'P0429' then null;
  end;
  -- Service-wide cap on queued discoveries.
  begin
    perform public.request_job_discovery(v_bob, 'busy||', 'Busy', null, null,
      now() - interval '1 hour', v_old, 5, 1, v_old);
    raise exception 'active cap not enforced';
  exception when sqlstate 'P0503' then null;
  end;

  -- The worker claims, completes with verified postings, and they are reused.
  select * into v_claim from public.claim_job_discovery(v_token, 60, 3);
  if v_claim.discovery_id <> v_first.discovery_id or v_claim.company <> 'サンプル'
    or v_claim.attempts <> 1 then
    raise exception 'claim returned %', v_claim;
  end if;
  begin
    perform public.complete_job_discovery(v_first.discovery_id, gen_random_uuid(), '[]');
    raise exception 'completed with a wrong token';
  exception when sqlstate '40001' then null;
  end;
  begin
    perform public.complete_job_discovery(v_first.discovery_id, v_token,
      '[{"url":"http://insecure.example/1","title":"x","companyName":"x","sourceKind":"web"}]');
    raise exception 'an http URL was stored';
  exception when sqlstate '22023' then null;
  end;
  v_count := public.complete_job_discovery(v_first.discovery_id, v_token, '[
    {"url":"https://careers.sample.example/jobs/1","title":"Backend Engineer",
     "companyName":"サンプル株式会社","sourceKind":"official",
     "employmentTypes":["FULL_TIME"],"location":"東京都","validThrough":null},
    {"url":"https://hrmos.co/pages/sample/jobs/2","title":"法人営業",
     "companyName":"サンプル株式会社","sourceKind":"ats","employmentTypes":[]}
  ]');
  if v_count <> 2
    or (select count(*) from public.read_job_discovery(v_alice, v_first.discovery_id)) <> 2
    or (select string_agg(source_kind, ',' order by result_position)
        from public.read_job_discovery(v_alice, v_first.discovery_id)) <> 'official,ats'
    or (select count(*) from public.job_postings j join public.source_urls s
        on s.id = j.source_url_id
        where s.normalized_url = 'https://careers.sample.example/jobs/1') <> 1 then
    raise exception 'verified postings were not stored once';
  end if;

  -- A fresh completed discovery is a cache hit for anyone, without a new event.
  select * into v_again from public.request_job_discovery(v_alice, 'sample|backend|',
    'サンプル', 'backend', null, now() - interval '1 hour', v_old, 1, 5, v_old);
  if v_again.discovery_id <> v_first.discovery_id or not v_again.cached then
    raise exception 'fresh discovery was not reused';
  end if;
  -- Carol only reuses the finished, cached result: that also grants access.
  if exists (select 1 from public.read_job_discovery('47000000-0000-4000-8000-000000000003',
      v_first.discovery_id)) then
    raise exception 'access before reuse';
  end if;
  perform public.request_job_discovery('47000000-0000-4000-8000-000000000003',
    'sample|backend|', 'サンプル', 'backend', null, now() - interval '1 hour', v_old, 1, 5, v_old);
  if (select count(*) from public.read_job_discovery('47000000-0000-4000-8000-000000000003',
      v_first.discovery_id)) <> 2 then
    raise exception 'cache reuse did not grant access';
  end if;
end;
$$;
reset role;

-- After the freshness window a new discovery is needed; failures retry, then fail.
update public.job_discovery_requests set completed_at = now() - interval '2 hours';
set local role service_role;
do $$
declare
  v_bob uuid := '47000000-0000-4000-8000-000000000002';
  v_new record;
  v_token uuid := gen_random_uuid();
  v_status text;
begin
  select * into v_new from public.request_job_discovery(v_bob, 'sample|backend|',
    'サンプル', 'backend', null, now() - interval '1 hour', now() - interval '1 day', 5, 5,
    now() - interval '30 days');
  if v_new.cached or v_new.discovery_status <> 'queued' then
    raise exception 'stale discovery was reused';
  end if;
  perform public.claim_job_discovery(v_token, 60, 1);
  perform public.fail_job_discovery(v_new.discovery_id, v_token, 'search_blocked', 1);
  select discovery_status into v_status from public.read_job_discovery(v_bob, v_new.discovery_id) limit 1;
  if v_status <> 'failed' then
    raise exception 'a blocked search did not fail after the last attempt';
  end if;
end;
$$;
reset role;

-- Deleting an account removes its events and access only; the shared
-- discovery, other users' access and the postings stay.
delete from auth.users where id = '47000000-0000-4000-8000-000000000001';
do $$
begin
  if exists (select 1 from public.job_discovery_access
      where user_id = '47000000-0000-4000-8000-000000000001')
    or not exists (select 1 from public.job_discovery_access
      where user_id = '47000000-0000-4000-8000-000000000002')
    or (select count(*) from public.job_discovery_requests) < 1
    or exists (select 1 from public.job_resolver_events
      where user_id = '47000000-0000-4000-8000-000000000001')
    or not exists (select 1 from public.job_postings j join public.source_urls s
      on s.id = j.source_url_id where s.normalized_url = 'https://hrmos.co/pages/sample/jobs/2') then
    raise exception 'account deletion did not keep postings or drop events';
  end if;
end;
$$;
rollback;

do $$
begin
  if has_function_privilege('authenticated', 'public.request_job_discovery(uuid,text,text,text,text,timestamptz,timestamptz,integer,integer,timestamptz)', 'execute')
    or has_function_privilege('anon', 'public.read_job_discovery(uuid,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.read_job_discovery_query(uuid,uuid)', 'execute')
    or has_table_privilege('authenticated', 'public.job_discovery_access', 'SELECT')
    or has_table_privilege('anon', 'public.job_discovery_access', 'INSERT')
    or has_table_privilege('authenticated', 'public.job_discovery_requests', 'SELECT') then
    raise exception 'clients can reach job discovery';
  end if;
end;
$$;
