import { useState } from "react";
import { Mascot } from "../../components/Mascot";
import { formatDateTime } from "../../lib/format-date";
import {
  defaultHistoryFilter,
  filterHistory,
  jobTitleOptions,
  judgementLabels,
  sortLabels,
  type HistoryFilter,
  type HistoryItem,
  type HistorySort,
  type Judgement,
} from "./history-model";

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
            近い {item.summary.close}　相違 {item.summary.different}　不明{" "}
            {item.summary.unknown}
          </span>
          <span className="meta">
            {`${formatDateTime(item.analyzedAt)}・希望条件 第${item.profileVersion}版`}
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

/** Filterable history list; saving or bookmarking does not exist by design. */
export function HistoryList({ items, onOpen }: Props) {
  const [filter, setFilter] = useState<HistoryFilter>(defaultHistoryFilter);
  const visible = filterHistory(items, filter);

  return (
    <>
      <div className="filterbar" role="group" aria-label="職種で絞り込む">
        <button
          className="chip"
          type="button"
          aria-pressed={filter.jobTitle === null}
          onClick={() => setFilter({ ...filter, jobTitle: null })}
        >
          すべて
        </button>
        {jobTitleOptions(items).map((title) => (
          <button
            key={title}
            className="chip"
            type="button"
            aria-pressed={filter.jobTitle === title}
            onClick={() => setFilter({ ...filter, jobTitle: title })}
          >
            {title}
          </button>
        ))}
      </div>
      <div className="filter-grid">
        <label className="visually-hidden" htmlFor="judgement-filter">
          判定で絞り込む
        </label>
        <select
          id="judgement-filter"
          className="select"
          value={filter.judgement}
          onChange={(event) =>
            setFilter({ ...filter, judgement: event.target.value as Judgement })
          }
        >
          {Object.entries(judgementLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor="history-sort">
          並び順
        </label>
        <select
          id="history-sort"
          className="select"
          value={filter.sort}
          onChange={(event) =>
            setFilter({ ...filter, sort: event.target.value as HistorySort })
          }
        >
          {Object.entries(sortLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {visible.length > 0 ? (
        <ul className="list" aria-label="分析済み企業の一覧">
          {visible.map((item) => (
            <HistoryRow key={item.matchResultId} item={item} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <div className="empty">
          <Mascot pose="worried" size="small" />
          <p>
            {items.length === 0
              ? "まだ分析した求人はありません。"
              : "この条件ではまだないみたい。"}
          </p>
        </div>
      )}
    </>
  );
}
