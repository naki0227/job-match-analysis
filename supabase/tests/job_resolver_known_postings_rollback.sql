do $$
begin
  if to_regprocedure('public.search_known_job_postings(text,integer)') is not null then
    raise exception 'Job Resolver search function survived rollback';
  end if;
end;
$$;
