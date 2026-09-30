do $$
begin
  if to_regclass('public.abuse_signal_events') is not null
    or to_regprocedure('public.record_abuse_signal(uuid,text,bytea,bytea)') is not null
    or to_regprocedure('public.abuse_signal_overview(timestamptz)') is not null then
    raise exception 'Issue #42 abuse signal rollback left objects behind';
  end if;
end;
$$;
