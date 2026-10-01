-- Ensure privacy v1.1 sorts after v1.0 in legal_documents_current_at.
-- Both were initially stamped at the same instant, leaving UUID order to decide
-- the current row. No acknowledgement may exist for v1.1 when correcting this.
begin;

do $$
begin
  if exists (
    select 1
    from public.user_legal_acknowledgements a
    join public.legal_documents d on d.id = a.legal_document_id
    where d.document_type = 'privacy_policy' and d.version = '1.1'
  ) then
    raise exception 'privacy_policy v1.1 already acknowledged; publish a new version instead';
  end if;
end;
$$;

do $
declare
  v_updated integer;
begin
  update public.legal_documents
  set published_at = '2026-10-01 00:00:01+09',
      effective_at = '2026-10-01 00:00:01+09'
  where document_type = 'privacy_policy' and version = '1.1';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'privacy_policy v1.1 is missing or duplicated';
  end if;
end;
$;

commit;
