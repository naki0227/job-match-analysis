import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { defaultHistoryFilter } from "../src/features/history/history-model";
import { HistoryScreen } from "../src/features/history/HistoryScreen";
import type { AnalysisHistoryState } from "../src/features/history/useAnalysisHistory";
import { historyItems } from "./fixtures/history";

afterEach(cleanup);
const ready = (
  items: typeof historyItems,
): Extract<AnalysisHistoryState, { status: "ready" }> => ({
  status: "ready",
  items,
  hasMore: false,
  loadingMore: false,
  loadMore: vi.fn(),
});
const props = {
  filter: defaultHistoryFilter,
  onFilterChange: vi.fn(),
  onOpen: vi.fn(),
};

test("loading and failure states explain what happened", () => {
  const { rerender } = render(
    <HistoryScreen {...props} history={{ status: "loading" }} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
  const retry = vi.fn();
  rerender(
    <HistoryScreen
      {...props}
      history={{ status: "error", unauthorized: false, retry }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "再試行" }));
  expect(retry).toHaveBeenCalledOnce();
});

test("rows open the match and warn about stale conditions", () => {
  const onOpen = vi.fn();
  render(
    <HistoryScreen {...props} history={ready(historyItems)} onOpen={onOpen} />,
  );
  const list = screen.getByRole("list", { name: "分析済み企業の一覧" });
  expect(within(list).getAllByRole("button")).toHaveLength(3);
  expect(within(list).getByText(/求人条件が古い可能性/)).toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: /サンプルテック/ }));
  expect(onOpen).toHaveBeenCalledWith(historyItems[0]!.matchResultId);
  fireEvent.change(screen.getByLabelText("判定"), {
    target: { value: "has_unknown" },
  });
  expect(props.onFilterChange).toHaveBeenCalledWith({
    ...defaultHistoryFilter,
    judgement: "has_unknown",
  });
});

test("an empty page and next page are explicit", () => {
  const loadMore = vi.fn();
  const { rerender } = render(<HistoryScreen {...props} history={ready([])} />);
  expect(screen.getByText(/この条件では/)).toBeInTheDocument();
  rerender(
    <HistoryScreen
      {...props}
      history={{ ...ready(historyItems), hasMore: true, loadMore }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "さらに表示" }));
  expect(loadMore).toHaveBeenCalledOnce();
});
