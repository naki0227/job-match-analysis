import type { AnalysisHistoryItem } from "@job-match/contracts";

/** One analyzed job with its profile/evaluation version pair. */
export type HistoryItem = AnalysisHistoryItem;

export type Judgement =
  "all" | "mostly_close" | "has_different" | "has_unknown";
export type HistorySort = "recent" | "close" | "fewest_unknown";

export type HistoryFilter = {
  role: string | null;
  judgement: Judgement;
  sort: HistorySort;
};

export const defaultHistoryFilter: HistoryFilter = {
  role: null,
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
