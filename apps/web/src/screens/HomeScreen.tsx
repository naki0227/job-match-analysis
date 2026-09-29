import { Mascot } from "../components/Mascot";
import { PendingFeature } from "../components/PendingFeature";
import { AnalyzeForm } from "../features/analysis/AnalyzeForm";
import {
  filterHistory,
  defaultHistoryFilter,
} from "../features/history/history-model";
import { HistoryRow } from "../features/history/HistoryList";
import type { AnalysisHistoryState } from "../features/history/useAnalysisHistory";
import "../features/analysis/analysis.css";
import "../features/history/history.css";

type Props = {
  /** Saved profile version; null when none is saved, undefined while unknown. */
  profileVersion: number | null | undefined;
  history: AnalysisHistoryState;
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
  if (history.status !== "ready") {
    return (
      <PendingFeature
        title="最近の分析はまだ表示できません"
        reason="分析履歴の一覧APIの接続待ちです（Issue #27）。"
      />
    );
  }
  const recent = filterHistory(history.items, defaultHistoryFilter).slice(0, 3);
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
          />
        ))}
      </ul>
      <button className="text-btn" type="button" onClick={onShowHistory}>
        すべて見る
      </button>
    </>
  );
}

export function HomeScreen({
  profileVersion,
  history,
  onAnalyze,
  onEditProfile,
  onShowHistory,
  onOpenMatch,
}: Props) {
  return (
    <section aria-labelledby="home-heading">
      <div className="hero">
        <div>
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
      <AnalyzeForm busy={false} invalid={false} onSubmit={onAnalyze} />
      <section className="section" aria-labelledby="recent-heading">
        <h2 id="recent-heading">最近の分析</h2>
        <RecentAnalyses
          history={history}
          onShowHistory={onShowHistory}
          onOpenMatch={onOpenMatch}
        />
      </section>
      <div className="slim">
        <div>
          <strong>希望条件（Career Profile）</strong>
          <p className="meta">
            {profileVersion === null
              ? "未入力です。比較の前に入力してください。"
              : profileVersion === undefined
                ? "8つの軸と必須条件を、いつでも見直せます。"
                : `第${profileVersion}版を保存済み。いつでも見直せます。`}
          </p>
        </div>
        <button className="text-btn" type="button" onClick={onEditProfile}>
          {profileVersion === null ? "入力する" : "見直す"}
        </button>
      </div>
    </section>
  );
}
