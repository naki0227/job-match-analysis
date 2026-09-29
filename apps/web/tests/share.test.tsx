import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the card keeps only counts and close axis names", () => {
  const card = toShareCard(sampleReport);
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
  drawShareCard(ctx, toShareCard(sampleReport));
  expect(texts).toEqual(
    expect.arrayContaining([
      "サンプルテック株式会社",
      "Backend Engineer",
      "近い軸：裁量",
      "本名・メール・希望年収・希望勤務地・希望値は含みません",
    ]),
  );
});

test("the report opens a share dialog; the public page is not faked", () => {
  render(<MatchReport report={sampleReport} />);
  fireEvent.click(screen.getByRole("button", { name: "共有カードを作る" }));
  const dialog = screen.getByRole("dialog", { name: "共有カード" });
  expect(within(dialog).getByRole("link", { name: "Xで共有" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(within(dialog).getByRole("note")).toHaveTextContent("Issue #39");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fireEvent.click(within(dialog).getByRole("button", { name: "画像を保存" }));
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "画像を作れませんでした",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
