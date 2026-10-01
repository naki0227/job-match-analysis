do $$
declare
  v_doc record;
begin
  select * into v_doc
  from public.legal_documents
  where document_type = 'privacy_policy' and version = '1.1';

  if v_doc.id is null then
    raise exception 'privacy policy v1.1 is missing';
  end if;
  if v_doc.published_at <> '2026-09-30T15:00:01Z'::timestamptz
    or v_doc.effective_at <> '2026-09-30T15:00:01Z'::timestamptz then
    raise exception 'privacy policy v1.1 is not effective from 2026-10-01 JST';
  end if;
  if v_doc.body_markdown not like '%### DuckDuckGo%'
    or v_doc.body_markdown not like '%企業名、職種、雇用形態その他求人候補を絞るための検索語%'
    or v_doc.body_markdown not like '%氏名、メールアドレス、Googleアカウント識別情報%'
    or v_doc.body_markdown not like '%求人の候補としてのみ扱い%' then
    raise exception 'privacy policy v1.1 does not disclose DDGS discovery';
  end if;
  if (select version from public.legal_documents_current_at('2026-10-01 00:00:01+09')
      where document_type = 'privacy_policy') <> '1.1' then
    raise exception 'privacy policy v1.1 is not the current version';
  end if;
  if (select version from public.legal_documents_current_at('2026-10-01 00:00:01+09')
      where document_type = 'terms') <> '1.0' then
    raise exception 'terms version changed unexpectedly';
  end if;
end;
$$;
