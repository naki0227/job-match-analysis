do $$
begin
  if exists (select 1 from public.legal_documents
      where (document_type, version) in (('terms', '1.0'), ('privacy_policy', '1.0'))) then
    raise exception 'v1.0 documents survived rollback';
  end if;
end;
$$;
