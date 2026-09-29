/** One analyzed job in the caller's history (Issue #27). */
export type HistoryItem = {
  matchResultId: string;
  companyName: string;
  jobTitle: string;
  analyzedAt: string;
  profileVersion: number;
  summary: { close: number; different: number; unknown: number };
  /** Important job conditions are older than the freshness window. */
  staleConditions: boolean;
};

export type Judgement =
  "all" | "mostly_close" | "has_different" | "has_unknown";
export type HistorySort = "recent" | "close" | "fewest_unknown";

export type HistoryFilter = {
  jobTitle: string | null;
  judgement: Judgement;
  sort: HistorySort;
};

export const defaultHistoryFilter: HistoryFilter = {
  jobTitle: null,
  judgement: "all",
  sort: "recent",
};

export const judgementLabels: Record<Judgement, string> = {
  all: "判定：すべて",
  mostly_close: "近いが多い",
  has_different: "相違あり",
  has_unknown: "不明あり",
};

export const sortLabels: Record<HistorySort, string> = {
  recent: "新しい順",
  close: "近いが多い順",
  fewest_unknown: "不明が少ない順",
};

function matchesJudgement(item: HistoryItem, judgement: Judgement): boolean {
  const { close, different, unknown } = item.summary;
  switch (judgement) {
    case "all":
      return true;
    case "mostly_close":
      return close > different;
    case "has_different":
      return different > 0;
    case "has_unknown":
      return unknown > 0;
  }
}

function compare(sort: HistorySort) {
  const recent = (a: HistoryItem, b: HistoryItem) =>
    Date.parse(b.analyzedAt) - Date.parse(a.analyzedAt);
  return (a: HistoryItem, b: HistoryItem) => {
    const primary =
      sort === "close"
        ? b.summary.close - a.summary.close
        : sort === "fewest_unknown"
          ? a.summary.unknown - b.summary.unknown
          : 0;
    return primary !== 0 ? primary : recent(a, b);
  };
}

export function filterHistory(
  items: readonly HistoryItem[],
  filter: HistoryFilter,
): HistoryItem[] {
  return items
    .filter(
      (item) =>
        (filter.jobTitle === null || item.jobTitle === filter.jobTitle) &&
        matchesJudgement(item, filter.judgement),
    )
    .sort(compare(filter.sort));
}

/** Distinct job titles in first-seen order, for the filter chips. */
export function jobTitleOptions(items: readonly HistoryItem[]): string[] {
  return [...new Set(items.map((item) => item.jobTitle))];
}
