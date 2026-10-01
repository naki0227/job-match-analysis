begin;

do $$
begin
  if exists (
    select 1
    from public.user_legal_acknowledgements a
    join public.legal_documents d on d.id = a.legal_document_id
    where d.document_type = 'privacy_policy' and d.version = '1.1'
  ) then
    raise exception 'privacy_policy v1.1 already acknowledged; cannot move its effective date';
  end if;
end;
$$;

update public.legal_documents
set published_at = '2026-10-01 00:00:00+09',
    effective_at = '2026-10-01 00:00:00+09'
where document_type = 'privacy_policy' and version = '1.1';

commit;
