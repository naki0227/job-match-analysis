-- Issue #42 / ADR-042: pseudonymous abuse signals with 7-day retention.
do $$
declare
  v_user uuid := '42a00000-0000-4000-8000-000000000001';
  v_other uuid := '42a00000-0000-4000-8000-000000000002';
  v_ip bytea := decode(repeat('ab', 32), 'hex');
  v_ua bytea := decode(repeat('cd', 32), 'hex');
  v_row record;
begin
  insert into auth.users(id) values (v_user), (v_other);
  insert into public.profiles(id) values (v_user), (v_other);

  perform public.record_abuse_signal(v_user, 'analysis_new', v_ip, v_ua);
  perform public.record_abuse_signal(v_other, 'analysis_new', v_ip, null);
  perform public.record_abuse_signal(v_other, 'share_created', null, null);

  -- Only the fixed event types and 32-byte HMACs are accepted.
  begin
    perform public.record_abuse_signal(v_user, 'match_viewed', null, null);
    raise exception 'unknown event type was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_abuse_signal(v_user, 'analysis_new',
      convert_to('203.0.113.7', 'UTF8'), null);
    raise exception 'a raw IP-sized value was accepted';
  exception when check_violation then null;
  end;

  select * into v_row from public.abuse_signal_overview(now() - interval '1 day')
  where event_type = 'analysis_new';
  if v_row.events <> 2 or v_row.users <> 2 or v_row.max_users_per_ip_key <> 2 then
    raise exception 'overview did not count users sharing one IP key';
  end if;

  -- Rows older than 7 days are purged by the next write.
  update public.abuse_signal_events set created_at = now() - interval '8 days'
  where user_id = v_other and event_type = 'share_created';
  perform public.record_abuse_signal(v_user, 'career_profile_saved', null, null);
  if exists (select 1 from public.abuse_signal_events
      where created_at < now() - interval '7 days') then
    raise exception 'expired abuse signals were not purged';
  end if;

  -- Deleting the account removes that user's events only.
  delete from auth.users where id = v_user;
  if exists (select 1 from public.abuse_signal_events where user_id = v_user)
    or not exists (select 1 from public.abuse_signal_events where user_id = v_other) then
    raise exception 'account deletion did not cascade to abuse signals';
  end if;
  delete from auth.users where id = v_other;
end;
$$;

-- Clients can neither read nor call anything here.
do $$
begin
  if has_table_privilege('anon', 'public.abuse_signal_events', 'select')
    or has_table_privilege('authenticated', 'public.abuse_signal_events', 'select')
    or has_function_privilege('authenticated',
      'public.record_abuse_signal(uuid,text,bytea,bytea)', 'execute')
    or has_function_privilege('anon',
      'public.abuse_signal_overview(timestamptz)', 'execute')
    or not has_function_privilege('service_role',
      'public.record_abuse_signal(uuid,text,bytea,bytea)', 'execute') then
    raise exception 'abuse signal privileges are wrong';
  end if;
  if exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'abuse_signal_events'
        and column_name ~ '(^ip$|ip_address|user_agent$|raw)') then
    raise exception 'a raw IP or User-Agent column exists';
  end if;
end;
$$;
