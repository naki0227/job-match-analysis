do $$
begin
  if to_regclass('public.user_analysis_request_events') is not null
    or to_regprocedure('public.consume_analysis_request_allowance(uuid, timestamptz, integer)') is not null
    or to_regprocedure('public.abuse_user_signal_summary(timestamptz, integer)') is not null then
    raise exception 'Request allowance rollback left objects behind';
  end if;
end;
$$;
