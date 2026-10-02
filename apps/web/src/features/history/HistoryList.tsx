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
}: {
  item: HistoryItem;
  onOpen: (matchResultId: string) => void;
}) {
  return (
    <li>
      <button
        className="list-row"
        type="button"
        onClick={() => onOpen(item.matchResultId)}
      >
        <span>
          <strong>{item.companyName}</strong>
          <span className="meta">{item.jobTitle}</span>
          <span className="statusline">
            近い {item.summary.close}　相違 {item.summary.different}
            {item.summary.partial > 0 && (
              <>　一部近い {item.summary.partial}</>
            )}
            　不明 {item.summary.unknown}
          </span>
          <span className="meta">
            {`${formatDateTime(item.analyzedAt)}・希望条件 第${item.profileVersion}版`}
          </span>
          <span className="meta">希望職種: {item.targetRoles.join("、")}</span>
          <span className="meta version-pair">
            求人評価ID: {item.jobEvaluationId}
          </span>
          {item.staleConditions && (
            <span className="stale-badge">求人条件が古い可能性。確認を</span>
          )}
        </span>
        <span className="chev" aria-hidden="true">
          ›
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
