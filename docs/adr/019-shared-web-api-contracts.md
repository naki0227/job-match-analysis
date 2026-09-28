# ADR-019: WebとAPIの共有契約を独立パッケージに置く

## 背景と課題

Issue #24のWebとHono APIは動くが、health応答の構造を双方で別々に扱っていた。後続の画面とAPIで同じ意味のレスポンスがずれる前に、依存方向と実行時検証の場所を決める。

## 選択肢

- APIの型をWebから直接importする: ファイル数は少ないが、Webがサーバー実装へ依存する。
- domainにZod契約を置く: 共有は容易だが、純粋なdomainへHTTPと検証ライブラリを混ぜる。
- contractsパッケージを分ける: build順序が増えるが、Web/APIが同じ契約を参照できる。

## 決定

既存採用済みのZodを使うpackages/contractsを追加し、Web/APIだけが依存する。APIは共有型に合うhealth応答を返し、Webは外部から届いたJSONを共有schemaで検証する。domainはZod・HTTP・DBへ依存しない。applicationパッケージは具体的なユースケースとportが必要になったIssueで作成する。

## メリット・デメリット

契約変更を1箇所で検出し、Webの不正なAPI応答を安全に扱える。一方、workspaceの依存とbuild順序、Dockerへの同梱が必要になるため、root scripts・CI・Dockerfileでcontractsを先にbuildする。

## 見直し条件

契約が増えてWeb/APIで異なる公開範囲が必要になった場合、schemaを分割する。domainの意味とHTTP形状を混同しないように保つ。
