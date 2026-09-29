import { useState } from "react";
import { PendingFeature } from "../../components/PendingFeature";
import { prefectures } from "../career-profile/assessment-catalog";
import { useCareerProfile } from "../career-profile/useCareerProfile";

const prefectureNames = new Map<string, string>(prefectures);

export function ProfilePane() {
  return (
    <PendingFeature
      title="表示名・大学・学部・卒業予定"
      reason="任意プロフィールの保存先はありますが、入力APIがまだありません（Issue #38）。"
    />
  );
}

export function PreferencesPane({
  onEditProfile,
}: {
  onEditProfile: () => void;
}) {
  const profile = useCareerProfile();
  if (profile.isPending) return <p role="status">読み込み中です。</p>;
  if (profile.isError) {
    return (
      <p className="notice danger" role="alert">
        希望条件を読み込めませんでした。
      </p>
    );
  }
  const saved = profile.data;
  const constraints = saved?.profile.constraints;
  return (
    <>
      <dl className="facts">
        <div>
          <dt>希望職種</dt>
          <dd>{saved ? saved.profile.targetRoles.join("、") : "未保存"}</dd>
        </div>
        <div>
          <dt>最低年収</dt>
          <dd>
            {constraints?.minSalary
              ? `${constraints.minSalary.amount.toLocaleString("ja-JP")}円／年`
              : "指定なし"}
          </dd>
        </div>
        <div>
          <dt>勤務地</dt>
          <dd>
            {constraints && constraints.allowedPrefectureCodes.length > 0
              ? constraints.allowedPrefectureCodes
                  .map((code) => prefectureNames.get(code) ?? code)
                  .join("・")
              : "指定なし"}
          </dd>
        </div>
        <div>
          <dt>フルリモート</dt>
          <dd>{constraints?.fullRemoteRequired ? "必須" : "必須にしない"}</dd>
        </div>
      </dl>
      <div className="actions">
        <button className="secondary" type="button" onClick={onEditProfile}>
          {saved ? "希望条件と8軸を見直す" : "希望条件を入力する"}
        </button>
      </div>
    </>
  );
}

export function PrivacyPane() {
  return (
    <>
      <PendingFeature
        title="Community Insights・匿名集計への参加"
        reason="参加同意の記録と集計の設計が未確定です（Issue #40）。現在は誰のデータも集計に使っていません。"
      />
      <PendingFeature
        title="利用規約・プライバシーポリシーの確認履歴"
        reason="文書と確認履歴の保存先はありますが、表示・記録のAPIがまだありません（Issue #38）。"
      />
    </>
  );
}

export function NotificationsPane() {
  return (
    <PendingFeature
      title="解析完了などの通知"
      reason="通知機能はまだありません。解析の進み具合は求人分析の画面で確認できます。"
    />
  );
}

export function AccountPane({
  email,
  onSignOut,
}: {
  email: string | null;
  onSignOut: () => Promise<void>;
}) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <dl className="facts">
        <div>
          <dt>ログイン</dt>
          <dd>Googleアカウント</dd>
        </div>
        <div>
          <dt>メール</dt>
          <dd>{email ?? "取得できませんでした"}</dd>
        </div>
      </dl>
      <PendingFeature
        title="自分のデータのエクスポート・削除"
        reason="個人データの書き出しと削除の手順は準備中です（Issue #29）。"
      />
      <div className="actions">
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailed(false);
            onSignOut().catch(() => {
              setFailed(true);
              setBusy(false);
            });
          }}
        >
          ログアウト
        </button>
      </div>
      {failed && (
        <p className="notice danger" role="alert">
          ログアウトできませんでした。もう一度お試しください。
        </p>
      )}
    </>
  );
}
