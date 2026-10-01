do $$
begin
  if (select version
      from public.legal_documents_current_at('2026-10-01 00:00:02+09')
      where document_type = 'privacy_policy') <> '1.1' then
    raise exception 'privacy_policy v1.1 is not current after the ordering correction';
  end if;
  if (select version
      from public.legal_documents_current_at('2026-10-01 00:00:02+09')
      where document_type = 'terms') <> '1.0' then
    raise exception 'terms version changed unexpectedly';
  end if;
end;
$$;
