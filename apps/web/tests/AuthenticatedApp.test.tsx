import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthenticatedApp } from "../src/AuthenticatedApp";
import { sampleReport } from "./fixtures/match-report";
import { createQueryWrapper } from "./render-with-query";

const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("home submission moves to the analysis screen and shows progress", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: "pending", jobId }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<AuthenticatedApp getAccessToken={async () => "token"} />, {
    wrapper: createQueryWrapper(),
  });

  fireEvent.change(screen.getByLabelText("求人ページのURL"), {
    target: { value: "https://jobs.example.com/1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "分析する" }));

  expect(
    await screen.findByText("解析の順番を待っています"),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "求人を分析" })).toBeVisible();
  expect(screen.getByRole("button", { name: "求人分析" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByLabelText("求人ページのURL")).toHaveValue(
    "https://jobs.example.com/1",
  );
});

test("invalid URL is flagged without calling the API", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<AuthenticatedApp getAccessToken={async () => "token"} />, {
    wrapper: createQueryWrapper(),
  });
  fireEvent.click(screen.getByRole("button", { name: "求人分析" }));
  fireEvent.change(screen.getByLabelText("求人ページのURL"), {
    target: { value: "jobs.example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "分析する" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "https:// で始まる公開求人ページのURL",
  );
  expect(screen.getByLabelText("求人ページのURL")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

test("a cache hit shows the personal match report", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input) === "/api/v1/analyses"
      ? new Response(
          JSON.stringify({
            status: "completed",
            evaluationId: sampleReport.job.evaluationId,
            sourceFetchedAt: "2026-09-20T01:02:03.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      : new Response(JSON.stringify(sampleReport), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<AuthenticatedApp getAccessToken={async () => "token"} />, {
    wrapper: createQueryWrapper(),
  });
  fireEvent.change(screen.getByLabelText("求人ページのURL"), {
    target: { value: "https://jobs.example.com/1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "分析する" }));

  expect(
    await screen.findByRole("heading", { name: "サンプルテック株式会社" }),
  ).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith("/api/v1/matches", expect.anything());
});
