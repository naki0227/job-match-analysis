import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { toSharedMatch } from "@job-match/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { MatchReport } from "../src/features/result/MatchReport";
import {
  drawShareCard,
  shareText,
  toShareCard,
  xIntentUrl,
  type CardCanvas,
} from "../src/features/share/share-card";
import { sampleReport } from "./fixtures/match-report";
import { createQueryWrapper } from "./render-with-query";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("the card keeps only counts and close axis names", () => {
  const card = toShareCard(toSharedMatch(sampleReport));
  expect(card).toEqual({
    companyName: "サンプルテック株式会社",
    jobTitle: "Backend Engineer",
    close: 1,
    different: 1,
    unknown: 5,
    closeAxes: ["裁量"],
  });
  expect(JSON.stringify(card)).not.toMatch(/5000000|preference|東京/);
  expect(shareText(card)).toContain("近い1・相違1・不明5");
  expect(xIntentUrl(card)).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);
});

test("drawing writes the same fields to the canvas", () => {
  const texts: string[] = [];
  const ctx: CardCanvas = {
    fillStyle: "",
    font: "",
    fillRect: vi.fn(),
    fillText: (text: string) => {
      texts.push(text);
    },
  };
  drawShareCard(ctx, toShareCard(toSharedMatch(sampleReport)));
  expect(texts).toEqual(
    expect.arrayContaining([
      "サンプルテック株式会社",
      "Backend Engineer",
      "近い軸：裁量",
      "本名・メール・希望年収・希望勤務地・希望値は含みません",
    ]),
  );
});

test("the dialog creates, shows and revokes a public link", async () => {
  const token = "p".repeat(43);
  const share = {
    shareId: "7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
    token,
    sharedAt: "2026-09-29T01:00:00Z",
    projection: toSharedMatch(sampleReport),
  };
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (init?.method === "POST") return Response.json(share, { status: 201 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ code: "not_found" }, { status: 404 });
    }),
  );
  render(<MatchReport report={sampleReport} />, {
    wrapper: createQueryWrapper(),
  });
  fireEvent.click(screen.getByRole("button", { name: "共有カードを作る" }));
  const dialog = screen.getByRole("dialog", { name: "共有カード" });
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "公開リンクを作る" }),
  );
  const url = await within(dialog).findByRole("textbox", {
    name: "公開リンクのURL",
  });
  expect(url).toHaveValue(`${window.location.origin}/s/${token}`);
  expect(
    within(dialog).getByRole("link", { name: "Xで共有" }).getAttribute("href"),
  ).toContain(encodeURIComponent(`/s/${token}`));

  fireEvent.click(
    within(dialog).getByRole("button", { name: "リンクを無効にする" }),
  );
  expect(
    await within(dialog).findByRole("button", { name: "公開リンクを作る" }),
  ).toBeInTheDocument();
  expect(requests).toEqual([
    `GET /api/v1/me/matches/${sampleReport.matchResultId}/share`,
    `POST /api/v1/me/matches/${sampleReport.matchResultId}/share`,
    `DELETE /api/v1/me/shares/${share.shareId}`,
  ]);

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fireEvent.click(within(dialog).getByRole("button", { name: "画像を保存" }));
  expect(within(dialog).getAllByRole("status")[0]).toHaveTextContent(
    "画像を作れませんでした",
  );
});
