import { useState, type FormEvent } from "react";
import {
  judgementLabels,
  sortLabels,
  type HistoryFilter,
  type HistorySort,
  type Judgement,
} from "./history-model";

type Props = {
  filter: HistoryFilter;
  onChange: (filter: HistoryFilter) => void;
};

/** Search controls apply to the database before a page is selected. */
export function HistoryFilters({ filter, onChange }: Props) {
  const [roleDraft, setRoleDraft] = useState(filter.role ?? "");

  function applyRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onChange({ ...filter, role: roleDraft.trim() || null });
  }

  return (
    <>
      <form className="filterbar" onSubmit={applyRole}>
        <label htmlFor="history-role">希望職種で絞り込む</label>
        <input
          id="history-role"
          className="input"
          value={roleDraft}
          onChange={(event) => setRoleDraft(event.target.value)}
          maxLength={512}
          placeholder="例: Backend Engineer"
        />
        <button className="secondary" type="submit">
          適用
        </button>
        {filter.role && (
          <button
            className="text-btn"
            type="button"
            onClick={() => {
              setRoleDraft("");
              onChange({ ...filter, role: null });
            }}
          >
            職種を解除
          </button>
        )}
      </form>
      <div className="filter-grid">
        <label>
          判定
          <select
            className="select"
            value={filter.judgement}
            onChange={(event) =>
              onChange({
                ...filter,
                judgement: event.target.value as Judgement,
              })
            }
          >
            {Object.entries(judgementLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          並び順
          <select
            className="select"
            value={filter.sort}
            onChange={(event) =>
              onChange({ ...filter, sort: event.target.value as HistorySort })
            }
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
