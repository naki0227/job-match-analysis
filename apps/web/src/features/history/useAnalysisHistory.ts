import type { HistoryItem } from "./history-model";

export type AnalysisHistoryState =
  | { status: "not_connected" }
  | { status: "ready"; items: readonly HistoryItem[] };

/**
 * The history HTTP endpoint (Issue #27) is not published yet, so the screen
 * reports that plainly. Replace this with a TanStack Query call when it is.
 */
export function useAnalysisHistory(): AnalysisHistoryState {
  return { status: "not_connected" };
}
