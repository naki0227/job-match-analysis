do $$
begin
  if to_regprocedure('public.current_legal_documents()') is not null
    or to_regprocedure('public.legal_documents_current_at(timestamptz)') is not null
    or to_regprocedure('public.record_legal_acknowledgements(uuid,uuid,uuid)') is not null
    or to_regclass('public.user_legal_acknowledgements') is null then
    raise exception 'legal consent RPC rollback is incomplete or removed history';
  end if;
end;
$$;
