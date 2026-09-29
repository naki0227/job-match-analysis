import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MatchDetailScreen } from "../src/features/result/MatchDetailScreen";
import { sampleReport } from "./fixtures/match-report";
import { createQueryWrapper } from "./render-with-query";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("loads the stored match and returns to history", async () => {
  const fetcher = vi.fn(async () => json(sampleReport));
  vi.stubGlobal("fetch", fetcher);
  const onBack = vi.fn();
  render(
    <MatchDetailScreen
      matchResultId={sampleReport.matchResultId}
      onBack={onBack}
    />,
    { wrapper: createQueryWrapper() },
  );
  expect(
    await screen.findByRole("heading", { name: "サンプルテック株式会社" }),
  ).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith(
    `/api/v1/me/matches/${sampleReport.matchResultId}`,
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: /分析済み企業へ戻る/ }));
  expect(onBack).toHaveBeenCalled();
});

test("another user's or a missing match reads as not found", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code: "not_found" }, 404)),
  );
  render(
    <MatchDetailScreen
      matchResultId={sampleReport.matchResultId}
      onBack={vi.fn()}
    />,
    { wrapper: createQueryWrapper() },
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "見つかりませんでした",
  );
});
