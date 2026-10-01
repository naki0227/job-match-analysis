-- Privacy policy v1.1: disclose the optional DuckDuckGo-backed web
-- discovery before enabling it in production. Terms v1.0 is unchanged.
begin;

do $$
begin
  if exists (
    select 1 from public.legal_documents
    where document_type = 'privacy_policy' and version = '1.1'
  ) then
    raise exception 'privacy_policy v1.1 already exists; publish a new version instead'
      using errcode = '23505';
  end if;
end;
$$;

insert into public.legal_documents
  (document_type, version, body_markdown, published_at, effective_at)
select
  'privacy_policy',
  '1.1',
  replace(
    body_markdown,
    E'### Jev\n公開求人情報等の意味的な解析および求人候補の選択補助に利用する場合があります。\n\n',
    E'### Jev\n公開求人情報等の意味的な解析および求人候補の選択補助に利用する場合があります。\n\n### DuckDuckGo
企業名、職種、雇用形態等から公開求人候補を探すため、DDGSライブラリを通じてDuckDuckGoの検索機能を利用する場合があります。

検索時には、利用者が入力した企業名、職種、雇用形態その他求人候補を絞るための検索語をDuckDuckGoへ送信する場合があります。氏名、メールアドレス、Googleアカウント識別情報、Career Profileの各希望値、求人ページ本文は、Web検索のために送信しない設計としています。

DuckDuckGoから得たURLやタイトル等は求人の候補としてのみ扱い、本サービス側で公開ページを取得・確認したうえで利用します。

'
  ),
  '2026-10-01 00:00:01+09',
  '2026-10-01 00:00:01+09'
from public.legal_documents
where document_type = 'privacy_policy' and version = '1.0';

do $$
begin
  if (select count(*) from public.legal_documents
      where document_type = 'privacy_policy' and version = '1.1') <> 1 then
    raise exception 'privacy_policy v1.0 is missing or v1.1 could not be created';
  end if;
end;
$$;

commit;
