do $$
begin
  if to_regclass('public.user_analysis_quota_events') is not null
    or to_regprocedure('public.request_personal_analysis_limited(uuid,text,text,text,timestamptz,timestamptz,integer)') is not null
    or to_regclass('public.user_analysis_requests') is null then
    raise exception 'Issue #42 rollback left quota objects or removed requests';
  end if;
end;
$$;
