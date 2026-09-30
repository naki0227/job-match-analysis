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

## メリット・デメリット

利用者IDの上限を回避する複数アカウントの挙動を、7日間だけ仮名で見られる。一方、日付を含むため日をまたぐ同一接続元の追跡はできず、IPを安全に取り出せない配置では接続元のsignalが欠ける。

## 見直し条件

不正利用の実態が観測された時、配置（ADR-040）の信頼proxy境界が変わった時、保持期間の見直しが必要になった時。
