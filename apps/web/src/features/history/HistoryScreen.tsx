import { PendingFeature } from "../../components/PendingFeature";
import { HistoryList } from "./HistoryList";
import type { AnalysisHistoryState } from "./useAnalysisHistory";
import "./history.css";

type Props = {
  history: AnalysisHistoryState;
  onOpen: (matchResultId: string) => void;
};

export function HistoryScreen({ history, onOpen }: Props) {
  return (
    <section className="page-head narrow" aria-labelledby="history-heading">
      <div className="eyebrow">ANALYSIS HISTORY</div>
      <h1 id="history-heading">分析済み企業</h1>
      <p className="sub">
        分析した求人が自動で並びます。絞り込んで見返せます。
      </p>
      {history.status === "ready" ? (
        <HistoryList items={history.items} onOpen={onOpen} />
      ) : (
        <PendingFeature
          title="一覧はまだ表示できません"
          reason="分析履歴の一覧APIの接続待ちです（Issue #27）。"
        />
      )}
    </section>
  );
}
