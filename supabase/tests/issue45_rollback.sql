do $$
begin
  if to_regclass('public.user_saved_jobs') is null
    or to_regprocedure('public.list_saved_jobs_page(uuid,integer,timestamptz,uuid)') is null
    or to_regprocedure('public.list_analysis_history_page(uuid,integer,timestamptz,uuid)') is not null
    or (select count(*) from public.user_saved_jobs) <> 0
    or not (select relrowsecurity from pg_class
      where oid = 'public.user_saved_jobs'::regclass)
    or has_function_privilege('anon',
      'public.list_saved_jobs_page(uuid,integer,timestamptz,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role',
      'public.list_saved_jobs_page(uuid,integer,timestamptz,uuid)', 'EXECUTE') then
    raise exception 'Issue #45 rollback did not restore the old empty boundary';
  end if;
end;
$$;
