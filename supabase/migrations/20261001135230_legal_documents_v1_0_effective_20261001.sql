-- ADR-046 pre-release correction: make the already-published v1.0 legal
-- documents current from 2026-10-01 so production can be exercised before
-- the 2026-10-03 public announcement. This is allowed only before any user
-- acknowledgement exists; after that, corrections require a new version.
begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.legal_documents
  where (document_type, version) in (
    ('terms', '1.0'),
    ('privacy_policy', '1.0')
  );
  if v_count <> 2 then
    raise exception 'legal_documents v1.0 pair is missing';
  end if;

  if exists (
    select 1
    from public.user_legal_acknowledgements a
    join public.legal_documents d on d.id = a.legal_document_id
    where d.version = '1.0'
      and d.document_type in ('terms', 'privacy_policy')
  ) then
    raise exception 'legal_documents v1.0 already acknowledged; publish a new version instead';
  end if;
end;
$$;

update public.legal_documents
set
  body_markdown = replace(
    replace(
      body_markdown,
      '公開日：2026年10月3日',
      '公開日：2026年10月1日'
    ),
    '適用開始日：2026年10月3日',
    '適用開始日：2026年10月1日'
  ),
  published_at = '2026-10-01 00:00:00+09',
  effective_at = '2026-10-01 00:00:00+09'
where (document_type, version) in (
  ('terms', '1.0'),
  ('privacy_policy', '1.0')
);

commit;
