import { Mascot } from "../../components/Mascot";
import { formatDateTime } from "../../lib/format-date";
import type { HistoryItem } from "./history-model";

type Props = {
  items: readonly HistoryItem[];
  onOpen: (matchResultId: string) => void;
};

export function HistoryRow({
  item,
  onOpen,
  compact = false,
}: {
  item: HistoryItem;
  onOpen: (matchResultId: string) => void;
  compact?: boolean;
}) {
  return (
    <li className={`history-card${compact ? " history-card-compact" : ""}`}>
      <button
        className="list-row"
        type="button"
        onClick={() => onOpen(item.matchResultId)}
      >
        <span className="history-card-content">
          <span className="history-card-top">
            <span>{formatDateTime(item.analyzedAt)}</span>
            <span className="history-profile-version">
              希望条件 第{item.profileVersion}版
            </span>
          </span>
          <strong>{item.companyName}</strong>
          <span className="history-job-title">{item.jobTitle}</span>
          <span className="statusline" aria-label="軸別の比較結果">
            <span className="summary-close">
              近い <b>{item.summary.close}</b>
            </span>
            <span className="summary-different">
              相違 <b>{item.summary.different}</b>
            </span>
            {item.summary.partial > 0 && (
              <span className="summary-partial">
                一部近い <b>{item.summary.partial}</b>
              </span>
            )}
            <span className="summary-unknown">
              不明 <b>{item.summary.unknown}</b>
            </span>
          </span>
          {!compact && (
            <>
              <span className="meta">
                希望職種: {item.targetRoles.join("、")}
              </span>
              <span className="meta version-pair">
                希望条件 第{item.profileVersion}版 ・ 求人評価ID:{" "}
                {item.jobEvaluationId}
              </span>
            </>
          )}
          {item.staleConditions && (
            <span className="stale-badge">
              求人条件が古い可能性。確認してください
            </span>
          )}
        </span>
        <span className="chev" aria-hidden="true">
          ↗
        </span>
      </button>
    </li>
  );
}

/** Renders the server-filtered page; saving or bookmarking does not exist. */
export function HistoryList({ items, onOpen }: Props) {
  return (
    <>
      {items.length > 0 ? (
        <ul className="list" aria-label="分析済み企業の一覧">
          {items.map((item) => (
            <HistoryRow key={item.matchResultId} item={item} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <div className="empty">
          <Mascot pose="worried" size="small" />
          <p>この条件では、まだ分析した求人がありません。</p>
        </div>
      )}
    </>
  );
}
