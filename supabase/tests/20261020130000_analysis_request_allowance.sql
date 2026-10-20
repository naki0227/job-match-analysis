-- Issue #42: the loose per-user request allowance and the audit summary.
insert into auth.users(id) values
  ('42100000-0000-4000-8000-000000000001'), ('42100000-0000-4000-8000-000000000002');
insert into public.profiles(id) values
  ('42100000-0000-4000-8000-000000000001'), ('42100000-0000-4000-8000-000000000002');

set role service_role;
do $$
declare
  v_granted integer := 0;
  n integer;
begin
  for n in 1..5 loop
    if public.consume_analysis_request_allowance(
        '42100000-0000-4000-8000-000000000001', now() - interval '1 hour', 3) then
      v_granted := v_granted + 1;
    end if;
  end loop;
  if v_granted <> 3 then
    raise exception 'Allowance granted % of 5 with a limit of 3', v_granted;
  end if;
  -- Another user has an independent allowance.
  if not public.consume_analysis_request_allowance(
      '42100000-0000-4000-8000-000000000002', now() - interval '1 hour', 3) then
    raise exception 'One user consumed another user''s allowance';
  end if;
  begin
    perform public.consume_analysis_request_allowance(
      '42100000-0000-4000-8000-000000000001', now() - interval '2 days', 3);
    raise exception 'A window longer than the retention was accepted';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;
reset role;

-- Requests outside the window no longer count, and day-old rows are trimmed.
update public.user_analysis_request_events
set created_at = now() - interval '2 days'
where user_id = '42100000-0000-4000-8000-000000000001';
set role service_role;
do $$
begin
  if not public.consume_analysis_request_allowance(
      '42100000-0000-4000-8000-000000000001', now() - interval '1 hour', 3) then
    raise exception 'Expired requests still count';
  end if;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from public.user_analysis_request_events
      where user_id = '42100000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Day-old request events were not trimmed';
  end if;
end;
$$;

-- Audit summary: two users share one daily IP pseudonym; signals of the new
-- types are accepted, and the summary never returns the pseudonyms.
set role service_role;
select public.record_abuse_signal('42100000-0000-4000-8000-000000000001', t,
  decode(repeat('ab', 32), 'hex'), decode(repeat('cd', 32), 'hex'))
from unnest(array['analysis_cached', 'analysis_rate_limited', 'analysis_new']) t;
select public.record_abuse_signal('42100000-0000-4000-8000-000000000002',
  'analysis_cached', decode(repeat('ab', 32), 'hex'), null);
do $$
declare
  v record;
begin
  select * into v from public.abuse_user_signal_summary(now() - interval '1 hour', 10)
  where user_id = '42100000-0000-4000-8000-000000000001';
  if v.cached_requests <> 1 or v.rate_limited <> 1 or v.new_analyses <> 1
    or v.distinct_ip_keys <> 1 or v.max_users_sharing_ip_key <> 2 then
    raise exception 'Unexpected audit summary: %', v;
  end if;
end;
$$;
reset role;

do $$
begin
  if exists (
    select 1 from information_schema.routines r
    join information_schema.parameters p
      on p.specific_name = r.specific_name and p.parameter_mode = 'OUT'
    where r.routine_name = 'abuse_user_signal_summary' and p.data_type = 'bytea'
  ) then
    raise exception 'The audit summary exposes pseudonyms';
  end if;
  if has_function_privilege('authenticated',
      'public.consume_analysis_request_allowance(uuid, timestamptz, integer)', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.abuse_user_signal_summary(timestamptz, integer)', 'EXECUTE') then
    raise exception 'Clients can call server-only functions';
  end if;
end;
$$;

-- Account deletion removes the request events with the user.
delete from auth.users where id::text like '42100000-%';
do $$
begin
  if exists (select 1 from public.user_analysis_request_events
             where user_id::text like '42100000-%') then
    raise exception 'Request events survived account deletion';
  end if;
end;
$$;
