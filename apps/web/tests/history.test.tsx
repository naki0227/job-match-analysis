import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  defaultHistoryFilter,
  filterHistory,
  jobTitleOptions,
} from "../src/features/history/history-model";
import { HistoryScreen } from "../src/features/history/HistoryScreen";
import { historyItems } from "./fixtures/history";

afterEach(cleanup);

const names = (items: { companyName: string }[]) =>
  items.map((item) => item.companyName);

test("default order is newest first", () => {
  expect(names(filterHistory(historyItems, defaultHistoryFilter))).toEqual([
    "サンプルラボ株式会社",
    "サンプルテック株式会社",
    "サンプルクラウド株式会社",
  ]);
});

test("job title, judgement and sort combine", () => {
  expect(
    names(
      filterHistory(historyItems, {
        jobTitle: "Backend Engineer",
        judgement: "all",
        sort: "close",
      }),
    ),
  ).toEqual(["サンプルクラウド株式会社", "サンプルテック株式会社"]);
  expect(
    names(
      filterHistory(historyItems, {
        ...defaultHistoryFilter,
        judgement: "has_different",
      }),
    ),
  ).toEqual(["サンプルラボ株式会社", "サンプルテック株式会社"]);
  expect(
    filterHistory(historyItems, {
      ...defaultHistoryFilter,
      judgement: "mostly_close",
      sort: "fewest_unknown",
    })[0]?.companyName,
  ).toBe("サンプルクラウド株式会社");
  expect(jobTitleOptions(historyItems)).toEqual([
    "Backend Engineer",
    "Frontend Engineer",
  ]);
});

test("unconnected history says so instead of showing samples", () => {
  render(
    <HistoryScreen history={{ status: "not_connected" }} onOpen={vi.fn()} />,
  );
  expect(screen.getByRole("note")).toHaveTextContent("Issue #27");
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

test("rows open the match, warn about stale conditions and filter", () => {
  const onOpen = vi.fn();
  render(
    <HistoryScreen
      history={{ status: "ready", items: historyItems }}
      onOpen={onOpen}
    />,
  );
  const list = screen.getByRole("list", { name: "分析済み企業の一覧" });
  expect(within(list).getAllByRole("button")).toHaveLength(3);
  expect(within(list).getByText(/求人条件が古い可能性/)).toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: /サンプルテック/ }));
  expect(onOpen).toHaveBeenCalledWith(historyItems[0]!.matchResultId);

  fireEvent.click(screen.getByRole("button", { name: "Frontend Engineer" }));
  expect(within(list).getAllByRole("button")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("判定で絞り込む"), {
    target: { value: "mostly_close" },
  });
  expect(screen.getByText("この条件ではまだないみたい。")).toBeInTheDocument();
});

test("an empty history explains that nothing was analyzed yet", () => {
  render(
    <HistoryScreen history={{ status: "ready", items: [] }} onOpen={vi.fn()} />,
  );
  expect(
    screen.getByText("まだ分析した求人はありません。"),
  ).toBeInTheDocument();
});
