import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AnalysisStatus } from "../src/features/analysis/AnalysisStatus";
import type { AnalysisState } from "../src/features/analysis/analysis-state";

const url = "https://jobs.example.com/1";
const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";
const evaluationId = "8a4d1c2e-51c1-4f4e-9f7e-6c3a1b2d4e5f";
const fetchedAt = "2026-09-20T01:02:03.000Z";

afterEach(cleanup);

function renderState(state: AnalysisState) {
  const onRetry = vi.fn();
  render(<AnalysisStatus state={state} onRetry={onRetry} />);
  return onRetry;
}

test("cache hit shows the source fetch time in JST", () => {
  renderState({
    kind: "ready",
    url,
    evaluationId,
    origin: "cache",
    sourceFetchedAt: fetchedAt,
  });
  expect(
    screen.getByText("解析済みの共有評価が見つかりました"),
  ).toBeInTheDocument();
  expect(screen.getByText("2026年9月20日 10:02")).toBeInTheDocument();
  expect(screen.queryByText(evaluationId)).not.toBeInTheDocument();
});

test("a new job shows queued and running progress separately", () => {
  renderState({ kind: "waiting", url, jobId, progress: "queued" });
  expect(screen.getByText("解析の順番を待っています")).toBeInTheDocument();
  cleanup();
  renderState({ kind: "waiting", url, jobId, progress: "running" });
  expect(screen.getByText("公開ページを確認しています")).toBeInTheDocument();
});

test("completed job is distinguished from a cache hit", () => {
  renderState({
    kind: "ready",
    url,
    evaluationId,
    origin: "job",
    sourceFetchedAt: null,
  });
  expect(screen.getByText("解析が完了しました")).toBeInTheDocument();
  expect(screen.queryByText("公開情報の取得日時")).not.toBeInTheDocument();
});

test("stale evaluation warns and offers a recheck after refresh failure", () => {
  const onRetry = renderState({
    kind: "stale",
    url,
    evaluationId,
    sourceFetchedAt: fetchedAt,
    refreshJobId: jobId,
    refresh: "failed",
  });
  expect(screen.getByText("前回の解析結果があります")).toBeInTheDocument();
  expect(screen.getByText(/取得日時の時点の情報/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "最新情報を再確認" }));
  expect(onRetry).toHaveBeenCalledWith(url);
});

test("stale evaluation under refresh has no retry button yet", () => {
  renderState({
    kind: "stale",
    url,
    evaluationId,
    sourceFetchedAt: fetchedAt,
    refreshJobId: jobId,
    refresh: "running",
  });
  expect(
    screen.getByText(/最新の公開情報を確認しています/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("failed job and timeout offer different guidance", () => {
  const onFailedRetry = renderState({ kind: "failed", url, jobId });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "このページは解析できませんでした",
  );
  fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
  expect(onFailedRetry).toHaveBeenCalledWith(url);
  cleanup();
  renderState({ kind: "timeout", url, jobId });
  expect(screen.getByText("解析に時間がかかっています")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "状態を確認する" }),
  ).toBeInTheDocument();
});

test("API errors use safe user-facing messages", () => {
  renderState({ kind: "error", url, reason: "unavailable" });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "現在、解析を受け付けられません",
  );
});

test("status wording never claims hiring suitability", () => {
  const states: AnalysisState[] = [
    { kind: "waiting", url, jobId, progress: "running" },
    { kind: "ready", url, evaluationId, origin: "job", sourceFetchedAt: null },
    { kind: "failed", url, jobId },
  ];
  for (const state of states) {
    const { container } = render(
      <AnalysisStatus state={state} onRetry={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/適性|合格|採用可能|性格/);
    cleanup();
  }
});

test("the personal result is rendered only for usable evaluations", () => {
  const renderResult = vi.fn((id: string) => <p>result {id}</p>);
  const { rerender } = render(
    <AnalysisStatus
      state={{ kind: "waiting", url, jobId, progress: "queued" }}
      onRetry={() => {}}
      renderResult={renderResult}
    />,
  );
  expect(renderResult).not.toHaveBeenCalled();
  rerender(
    <AnalysisStatus
      state={{
        kind: "stale",
        url,
        evaluationId,
        sourceFetchedAt: fetchedAt,
        refreshJobId: jobId,
        refresh: "running",
      }}
      onRetry={() => {}}
      renderResult={renderResult}
    />,
  );
  expect(screen.getByText(`result ${evaluationId}`)).toBeInTheDocument();
  expect(screen.getByRole("status")).not.toHaveTextContent("result");
});
