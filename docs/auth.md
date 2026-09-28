# Googleログインと個人データ権限

Issue #15の方針は[ADR-016](adr/016-google-auth-and-personal-read-rls.md)。Google OAuthをSupabase Authにつなぎ、Webは取得したaccess tokenをAPIへ送る。APIはSupabase Authの`getUser(token)`で検証し、Google identityがないユーザーを拒否する。大学所属のverified判定には使わない。

## 開発用Supabaseの設定

1. Google CloudでWebアプリ用OAuth Clientを作り、Supabase DashboardのGoogle provider画面に表示されるcallback URLをGoogle側のAuthorized redirect URIへ登録する。
2. Supabase DashboardでGoogle providerを有効にし、Client IDとClient Secretを設定する。Email・電話・匿名などGoogle以外のログイン経路は無効にする。ローカルCLIのGoogle設定は`supabase/config.toml`で環境変数を参照する。
3. Supabase AuthのSite URLとRedirect URL許可リストに開発用Web originを登録する。ローカル標準は`http://localhost:5173`。許可リストを広いwildcardにしない。
4. `apps/web/.env.example`を参考にWebの`.env.local`へproject URLと**publishable key**を設定する。`apps/api/.env.example`を参考にAPIの`.env.local`へproject URL、publishable key、**server-only secret key**を設定する。secret keyを`VITE_`変数やWebコンテナへ渡さない。
5. APIとWebを起動し、Googleログイン→`POST /api/v1/me/profile`の204→本人の`profiles`行が1件になることを確認する。再呼出しも204で行数は増えない。

開発用プロジェクトにはIssue #14の2 migrationとIssue #15の`personal_read_rls` migrationを適用する。クライアントの表権限は、`authenticated`の個人10表SELECTだけ。共有データはHono API経由でのみ提供する。Google providerの設定とOAuth Clientの秘密値はSQL migrationに含めない。

## ローカル検証

`pnpm test:db`は一時PostgreSQLで、別ユーザーの親・子・Matchの閲覧遮断、匿名の拒否、クライアント書込拒否、サーバー権限、rollbackを検証する。`supabase/config.toml`を使う場合は、リポジトリルートの無追跡`.env`に`GOOGLE_CLIENT_ID`と`GOOGLE_CLIENT_SECRET`を設定して`pnpm exec supabase start`を実行する。起動後に`pnpm test:auth`を実行すると、ローカルAuth・Data APIの匿名/認証済み/サーバー資格情報を確認できる。Googleの認証画面を通る実動作は、実際のOAuth Clientを使って別途確認する。

`POST /api/v1/me/profile`はbodyを受け取らず、Bearer tokenから本人を決める。未認証は401、Google identityなしは403、無効なbodyは400、Auth/DB/設定障害は503。エラーにトークン・個人情報・内部DB詳細を含めない。

Issue #15のRLSを戻す場合は[`supabase/rollback/20260928_issue15_down.sql`](../supabase/rollback/20260928_issue15_down.sql)を手動適用する。ポリシーを削除してもクライアント権限は戻さず、安全な拒否状態にする。
