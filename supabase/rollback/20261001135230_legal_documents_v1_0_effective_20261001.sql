-- Manual rollback for the pre-release v1.0 date correction.
-- Safe only while nobody has acknowledged v1.0.
begin;

do $$
begin
  if exists (
    select 1
    from public.user_legal_acknowledgements a
    join public.legal_documents d on d.id = a.legal_document_id
    where d.version = '1.0'
      and d.document_type in ('terms', 'privacy_policy')
  ) then
    raise exception 'legal_documents v1.0 already acknowledged; cannot move the effective date back';
  end if;
end;
$$;

update public.legal_documents
set
  body_markdown = replace(
    replace(
      body_markdown,
      '公開日：2026年10月1日',
      '公開日：2026年10月3日'
    ),
    '適用開始日：2026年10月1日',
    '適用開始日：2026年10月3日'
  ),
  published_at = '2026-10-03 00:00:00+09',
  effective_at = '2026-10-03 00:00:00+09'
where (document_type, version) in (
  ('terms', '1.0'),
  ('privacy_policy', '1.0')
);

commit;
