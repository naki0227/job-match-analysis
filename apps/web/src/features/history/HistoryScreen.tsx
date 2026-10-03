import { HistoryFilters } from "./HistoryFilters";
import { HistoryList } from "./HistoryList";
import type { HistoryFilter } from "./history-model";
import type { AnalysisHistoryState } from "./useAnalysisHistory";
import "./history.css";

type Props = {
  history: AnalysisHistoryState;
  filter: HistoryFilter;
  onFilterChange: (filter: HistoryFilter) => void;
  onOpen: (matchResultId: string) => void;
};

export function HistoryScreen({
  history,
  filter,
  onFilterChange,
  onOpen,
}: Props) {
  return (
    <section
      className="page-head narrow history-screen"
      aria-labelledby="history-heading"
    >
      <div className="history-intro">
        <h1 id="history-heading">分析済み企業</h1>
        <p className="sub">
          分析した求人が自動で並びます。気になる条件で絞り込んで、根拠を見返せます。
        </p>
      </div>
      <HistoryFilters filter={filter} onChange={onFilterChange} />
      {history.status === "loading" && (
        <p role="status">分析履歴を読み込み中です。</p>
      )}
      {history.status === "error" && (
        <div role="alert">
          <p>
            {history.unauthorized
              ? "ログインし直してください。"
              : "分析履歴を取得できませんでした。"}
          </p>
          <button type="button" onClick={history.retry}>
            再試行
          </button>
        </div>
      )}
      {history.status === "ready" && (
        <>
          <HistoryList items={history.items} onOpen={onOpen} />
          {history.hasMore && (
            <button
              className="secondary"
              type="button"
              disabled={history.loadingMore}
              onClick={history.loadMore}
            >
              {history.loadingMore ? "読み込み中" : "さらに表示"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
