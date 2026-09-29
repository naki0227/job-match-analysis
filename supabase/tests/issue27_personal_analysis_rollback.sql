do $$
begin
  if to_regclass('public.user_analysis_requests') is not null
    or to_regprocedure('public.request_personal_analysis(uuid,text,text,text,timestamptz)') is not null
    or to_regprocedure('public.list_unmatched_analysis_evaluations(uuid,integer)') is not null then
    raise exception 'Personal analysis interest rollback incomplete';
  end if;
end $$;
