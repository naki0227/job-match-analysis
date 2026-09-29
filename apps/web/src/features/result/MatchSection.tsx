import { MatchReport } from "./MatchReport";
import { useMatchReport } from "./useMatchReport";

type Props = {
  evaluationId: string;
  getAccessToken: () => Promise<string>;
  onEditProfile: () => void;
};

const errorMessages = {
  not_comparable:
    "この評価はあなたの希望条件と比較できない形式でした。新しい解析を待ってから再度お試しください。",
  not_found: "評価が見つかりませんでした。もう一度URLを送信してください。",
  unauthorized:
    "ログインの有効期限が切れました。再読み込みしてログインしてください。",
  unavailable:
    "比較結果を取得できませんでした。時間をおいて再試行してください。",
} as const;

/** Loads and shows the caller's comparison for one shared evaluation. */
export function MatchSection({
  evaluationId,
  getAccessToken,
  onEditProfile,
}: Props) {
  const { report, loading, errorKind, retry } = useMatchReport({
    evaluationId,
    getAccessToken,
  });

  if (loading) {
    return (
      <p className="notice" role="status">
        あなたの希望条件と比較しています…
      </p>
    );
  }
  if (errorKind === "profile_required") {
    return (
      <div className="notice" role="status">
        <p>
          比較するには、先に希望条件（8つの軸と必須条件）を保存してください。
        </p>
        <div className="actions">
          <button className="secondary" type="button" onClick={onEditProfile}>
            希望条件を入力する
          </button>
        </div>
      </div>
    );
  }
  if (errorKind) {
    return (
      <div className="notice danger" role="alert">
        <p>{errorMessages[errorKind]}</p>
        {errorKind === "unavailable" && (
          <div className="actions">
            <button className="secondary" type="button" onClick={retry}>
              再試行
            </button>
          </div>
        )}
      </div>
    );
  }
  return report ? <MatchReport report={report} /> : null;
}
