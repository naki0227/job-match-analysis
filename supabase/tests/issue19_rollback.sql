do $$
begin
  if to_regprocedure('public.request_analysis(text,text,text,timestamptz)') is not null
    or to_regclass('public.analysis_jobs_completed_lookup_idx') is not null then
    raise exception 'Issue #19 rollback left RPC or index';
  end if;
end;
$$;
