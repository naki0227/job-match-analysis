do $$
begin
  if to_regprocedure('public.list_analysis_history_page_v2(uuid,integer,timestamptz,text,text,text,integer,timestamptz,uuid)')
      is not null then
    raise exception 'History v2 RPC remained after rollback';
  end if;
end;
$$;
