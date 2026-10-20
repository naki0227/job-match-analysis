# ADR-042: 不正利用signal（IP・User-Agent）の保存方法と保持期間

## 背景・課題

Issue #42の主な制限は利用者IDごとの新規解析上限（ADR-039）。それを補うため、同じ接続元から多数のアカウントを作る、短時間に大量のURLを要求するなどの不正利用を見分けたい。しかし生のIPアドレスとUser-Agentは個人に結びつきうる情報で、長く保存すると追跡にも使えてしまう。

## 決定（2026年09月30日、ユーザー決定）

- 生のIPアドレスと生のUser-AgentをDB・アプリケーションログ・telemetryへ保存しない。HMACの計算後はすぐ破棄する。
- 保存するのは日ごとの仮名だけ。
  - `ip_key_day = HMAC-SHA256(ABUSE_SIGNAL_SECRET, UTC_DATE + "|" + canonical_client_ip)`
  - `ua_key_day = HMAC-SHA256(ABUSE_SIGNAL_SECRET, UTC_DATE + "|" + raw_user_agent)`
  - 単純なSHA-256は使わない（IPv4は総当たりで戻せるため）。UTCの日付を含め、日をまたいだ追跡を難しくする。
- `ABUSE_SIGNAL_SECRET`はサーバー専用の秘密値。Git・ログ・クライアントに出さない。rotationの手順は`docs/development.md`に記録する（切り替えた日から新しい鍵で計算し、古い鍵のイベントは保持期間で自然に消える）。
- client IPは`X-Forwarded-For`などを無条件に信用しない。Azure Container AppsやCloudflareなど、信頼するproxyの境界を明示できる場合だけcanonicalなIPを取り出す。実行環境で安全に判断できない場合、IP signalは`null`とする。
- 保持期間は7日。利用者に結びつくイベントは退会でCASCADE削除し、7日を超えたイベントは削除する。長く残すのは集計値だけ。
- 見るsignal: 同じ日次IP仮名から来た利用者数、固有URLの要求頻度、取得失敗率、Jevの起動頻度、上限による拒否、不審なアカウント・プロフィール変更の頻度。
- これらのsignalは**security / audit用途に限る**。企業評価・求人評価・MatchEngine・軸の値・近い/相違の判定・CareerProfileへ混ぜない。
- Grafana等のmetricのラベルにIPやUser-AgentのHMACを載せない。

## 追記: 監査signalの種類と確認方法（2026年10月20日、Issue #42）

- 記録するイベント: `analysis_new`（新規・更新が必要な解析）、`analysis_cached`（cache hit）、`analysis_quota_rejected`、`analysis_rate_limited`、`career_profile_saved`（属性変更）、`share_created`。
- 次の値は既存の表から導く。新しいイベントは作らない。
  - 固有URLの要求頻度: `analysis_new`の件数。上限の数え方は`user_analysis_quota_events`。
  - Jevの起動頻度: 新規・更新の解析がジョブを作る件数（`analysis_new`）。
  - 取得失敗率: 本人の依頼に結びつくジョブのうち`failed`の件数。
- `abuse_signal_overview(since)`はイベント種別ごとの全体集計を返す。`abuse_user_signal_summary(since, limit)`は利用者ごとの件数を返す。
  - 項目は、各イベント数、失敗ジョブ数、日次IP仮名・UA仮名の種類数、同じIP仮名を使った利用者の最大数。
  - 並び順は、IP仮名の共有、上限による拒否、新規解析の順。
  - 返すのは件数だけで、仮名（bytea）そのものは返さない。どちらも`service_role`専用で、security reviewにだけ使う。
- 記録・失敗時のログに生IP・生UA・JWT・APIキーが出ないことを、実際のSupabase storeを通すテストで確認する。失敗時のログは固定文言1行だけ。

## メリット・デメリット

利用者IDの上限を回避する複数アカウントの挙動を、7日間だけ仮名で見られる。一方、日付を含むため日をまたぐ同一接続元の追跡はできず、IPを安全に取り出せない配置では接続元のsignalが欠ける。

## 見直し条件

不正利用の実態が観測された時、配置（ADR-040）の信頼proxy境界が変わった時、保持期間の見直しが必要になった時。
