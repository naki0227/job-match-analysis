import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MatchSection } from "../src/features/result/MatchSection";
import { jobEvaluationId, sampleReport } from "./fixtures/match-report";
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

function renderSection(onEditProfile = vi.fn()) {
  render(
    <MatchSection
      evaluationId={jobEvaluationId}
      getAccessToken={async () => "token"}
      onEditProfile={onEditProfile}
    />,
    { wrapper: createQueryWrapper() },
  );
  return onEditProfile;
}

test("shows progress and then the personal report", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(sampleReport, 201)),
  );
  renderSection();
  expect(screen.getByRole("status")).toHaveTextContent("比較しています");
  expect(
    await screen.findByRole("heading", { name: "サンプルテック株式会社" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "求人概要" })).toBeInTheDocument();
});

test("asks for a career profile before comparing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code: "profile_required" }, 409)),
  );
  const onEditProfile = renderSection();
  fireEvent.click(
    await screen.findByRole("button", { name: "希望条件を入力する" }),
  );
  expect(onEditProfile).toHaveBeenCalled();
});

test("temporary failures can be retried", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ code: "service_unavailable" }, 503))
    .mockResolvedValueOnce(json(sampleReport, 200));
  vi.stubGlobal("fetch", fetcher);
  renderSection();
  fireEvent.click(await screen.findByRole("button", { name: "再試行" }));
  expect(
    await screen.findByRole("heading", { name: "サンプルテック株式会社" }),
  ).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
