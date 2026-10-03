import { Mascot } from "../components/Mascot";
import { AnalyzeForm } from "../features/analysis/AnalyzeForm";
import { HistoryRow } from "../features/history/HistoryList";
import type { AnalysisHistoryState } from "../features/history/useAnalysisHistory";
import { JobFinder } from "../features/job-resolver/JobFinder";
import "../features/analysis/analysis.css";
import "../features/history/history.css";
import "./home.css";

type Props = {
  /** Saved profile version; null when none is saved, undefined while unknown. */
  profileVersion: number | null | undefined;
  history: AnalysisHistoryState;
  getAccessToken: () => Promise<string>;
  onAnalyze: (url: string) => void;
  onEditProfile: () => void;
  onShowHistory: () => void;
  onOpenMatch: (matchResultId: string) => void;
};

function RecentAnalyses({
  history,
  onShowHistory,
  onOpenMatch,
}: Pick<Props, "history" | "onShowHistory" | "onOpenMatch">) {
  if (history.status === "loading")
    return <p role="status">最近の分析を読み込み中です。</p>;
  if (history.status === "error")
    return (
      <p role="alert">
        最近の分析を取得できませんでした。
        <button type="button" onClick={history.retry}>
          再試行
        </button>
      </p>
    );
  const recent = history.items.slice(0, 3);
  if (recent.length === 0) {
    return <p className="meta">まだ分析した求人はありません。</p>;
  }
  return (
    <>
      <ul className="list" aria-label="最近の分析">
        {recent.map((item) => (
          <HistoryRow
            key={item.matchResultId}
            item={item}
            onOpen={onOpenMatch}
            compact
          />
        ))}
      </ul>
      <button
        className="text-btn home-all-link"
        type="button"
        onClick={onShowHistory}
      >
        分析履歴をすべて見る <span aria-hidden="true">↗</span>
      </button>
    </>
  );
}

export function HomeScreen({
  profileVersion,
  history,
  getAccessToken,
  onAnalyze,
  onEditProfile,
  onShowHistory,
  onOpenMatch,
}: Props) {
  return (
    <section className="home-screen" aria-labelledby="home-heading">
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">CAREER MATCH</div>
          <h1 id="home-heading">
            気になる求人を、
            <br />
            自分の軸で。
          </h1>
          <p className="sub">
            近い・違う・まだ分からない。公開情報を根拠に確かめます。
          </p>
        </div>
        <div className="hero-visual">
          <Mascot pose="laptop" />
        </div>
      </div>
      <section className="home-discovery" aria-labelledby="discover-heading">
        <div className="home-section-heading">
          <div>
            <h2 id="discover-heading">気になる会社から探す</h2>
          </div>
          <p>
            企業名から公開求人を探します。職種を入れると候補を絞り込めます。
          </p>
        </div>
        <JobFinder getAccessToken={getAccessToken} onAnalyze={onAnalyze} />
        <details className="direct-url">
          <summary>求人URLを直接入力</summary>
          <AnalyzeForm busy={false} invalid={false} onSubmit={onAnalyze} />
        </details>
      </section>
      <section className="section home-recent" aria-labelledby="recent-heading">
        <div className="home-section-heading">
          <div>
            <h2 id="recent-heading">最近の分析</h2>
          </div>
          <p>気になった求人を、あとから見返せます。</p>
        </div>
        <RecentAnalyses
          history={history}
          onShowHistory={onShowHistory}
          onOpenMatch={onOpenMatch}
        />
      </section>
      <div className="slim home-profile">
        <div>
          <strong>希望条件を、今の自分に合わせる。</strong>
          <p className="meta">
            {profileVersion === null
              ? "未入力です。比較の前に入力してください。"
              : profileVersion === undefined
                ? "8つの軸と必須条件を、いつでも見直せます。"
                : `第${profileVersion}版を保存済み。いつでも見直せます。`}
          </p>
        </div>
        <button className="text-btn" type="button" onClick={onEditProfile}>
          {profileVersion === null ? "入力する" : "見直す"}{" "}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </section>
  );
}
