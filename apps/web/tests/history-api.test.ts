import { expect, test, vi } from "vitest";
import {
  readAnalysisHistory,
  HistoryApiError,
} from "../src/features/history/history-api";
import { defaultHistoryFilter } from "../src/features/history/history-model";
import { historyItems } from "./fixtures/history";

test("reads a filtered page with the bearer token and cursor", async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ items: historyItems, nextCursor: "next" }),
        { status: 200 },
      ),
  );
  const filter = {
    ...defaultHistoryFilter,
    role: "Backend Engineer",
    judgement: "has_unknown" as const,
  };
  const page = await readAnalysisHistory(
    "token",
    filter,
    20,
    "previous",
    fetcher as typeof fetch,
  );
  expect(page.items).toHaveLength(3);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toContain("role=Backend+Engineer");
  expect(String(url)).toContain("cursor=previous");
  expect(init?.headers).toEqual({ Authorization: "Bearer token" });
});

test("does not expose API body and rejects malformed data", async () => {
  await expect(
    readAnalysisHistory(
      "token",
      defaultHistoryFilter,
      20,
      null,
      async () => new Response("secret", { status: 503 }),
    ),
  ).rejects.toMatchObject({ kind: "unavailable" });
  await expect(
    readAnalysisHistory(
      "token",
      defaultHistoryFilter,
      20,
      null,
      async () => new Response("{}", { status: 200 }),
    ),
  ).rejects.toBeInstanceOf(HistoryApiError);
  await expect(
    readAnalysisHistory(
      "token",
      defaultHistoryFilter,
      20,
      null,
      async () => new Response("", { status: 401 }),
    ),
  ).rejects.toMatchObject({ kind: "unauthorized" });
});
