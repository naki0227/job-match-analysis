-- ADR-046: pre-release correction makes v1.0 current from 2026-10-01 JST.
do $$
declare
  v_terms record;
  v_privacy record;
  v_effective constant timestamptz := '2026-09-30T15:00:00Z';
begin
  select * into v_terms from public.legal_documents
    where document_type = 'terms' and version = '1.0';
  select * into v_privacy from public.legal_documents
    where document_type = 'privacy_policy' and version = '1.0';

  if v_terms.published_at <> v_effective or v_terms.effective_at <> v_effective
    or v_privacy.published_at <> v_effective or v_privacy.effective_at <> v_effective then
    raise exception 'v1.0 timestamps are not 2026-10-01 JST';
  end if;

  if position(E'公開日：2026年10月1日  \n適用開始日：2026年10月1日' in v_terms.body_markdown) = 0
    or position(E'公開日：2026年10月1日  \n適用開始日：2026年10月1日' in v_privacy.body_markdown) = 0
    or v_terms.body_markdown like '%公開日：2026年10月3日%'
    or v_privacy.body_markdown like '%公開日：2026年10月3日%' then
    raise exception 'v1.0 body dates were not corrected';
  end if;

  if exists (
    select 1 from public.legal_documents_current_at(v_effective - interval '1 second')
    where id in (v_terms.id, v_privacy.id)
  ) then
    raise exception 'v1.0 is current before 2026-10-01 JST';
  end if;

  if (select count(*) from public.legal_documents_current_at(v_effective)
      where id in (v_terms.id, v_privacy.id)) <> 2 then
    raise exception 'v1.0 is not current at 2026-10-01 JST';
  end if;
end;
$$;
