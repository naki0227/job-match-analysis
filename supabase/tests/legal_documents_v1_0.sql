-- ADR-046: the published v1.0 terms and privacy policy.
do $$
declare
  v_terms record;
  v_privacy record;
  v_release constant timestamptz := '2026-10-02T15:00:00Z';
begin
  select * into v_terms from public.legal_documents
    where document_type = 'terms' and version = '1.0';
  select * into v_privacy from public.legal_documents
    where document_type = 'privacy_policy' and version = '1.0';
  if v_terms.id is null or v_privacy.id is null then
    raise exception 'v1.0 documents are missing';
  end if;
  -- 2026-10-03 00:00 in Japan is 2026-10-02 15:00 UTC.
  if v_terms.published_at <> v_release or v_terms.effective_at <> v_release
    or v_privacy.published_at <> v_release or v_privacy.effective_at <> v_release then
    raise exception 'v1.0 timestamps are not the 2026-10-03 JST release';
  end if;
  -- Guard against an empty, truncated or swapped body.
  if v_terms.body_markdown not like '# Job Match Analysis 利用規約%'
    or v_terms.body_markdown not like '%## 第20条（お問い合わせ）%'
    or v_terms.body_markdown not like '%大阪地方裁判所または大阪簡易裁判所%'
    or v_terms.body_markdown not like '%法令に従い遅滞なく開示します。'
    or v_privacy.body_markdown not like '# Job Match Analysis プライバシーポリシー%'
    or v_privacy.body_markdown not like '%## 16. お問い合わせ%'
    or v_privacy.body_markdown not like '%法令に従い遅滞なく開示します。'
    or v_terms.body_markdown like '%$terms_v1_0$%'
    or v_privacy.body_markdown like '%$privacy_v1_0$%'
    or position(E'公開日：2026年10月3日  \n適用開始日' in v_terms.body_markdown) = 0
    or length(v_terms.body_markdown) < 3000 or length(v_privacy.body_markdown) < 3000 then
    raise exception 'v1.0 bodies are not the published texts';
  end if;

  -- Not current one second before the release, current from the release on.
  if exists (select 1 from public.legal_documents_current_at(v_release - interval '1 second')
      where version = '1.0' and id in (v_terms.id, v_privacy.id)) then
    raise exception 'v1.0 is current before 2026-10-03 JST';
  end if;
  if (select count(*) from public.legal_documents_current_at(v_release)
      where id in (v_terms.id, v_privacy.id)) <> 2 then
    raise exception 'v1.0 is not current at the release';
  end if;

  -- The same type and version can never be inserted again.
  begin
    insert into public.legal_documents
      (document_type, version, body_markdown, published_at, effective_at)
      values ('terms', '1.0', 'duplicate', now(), now());
    raise exception 'a duplicate v1.0 was accepted';
  exception when unique_violation then null;
  end;
end;
$$;
