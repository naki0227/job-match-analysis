import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LegalHistory } from "../src/features/legal/LegalHistory";
import { createQueryWrapper } from "./render-with-query";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("settings show the confirmed versions and earlier records", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        complete: false,
        terms: {
          documentId: "46100000-0000-4000-8000-000000000005",
          version: "1.1",
          recordedAt: null,
        },
        privacyPolicy: {
          documentId: "46100000-0000-4000-8000-000000000002",
          version: "1.0",
          recordedAt: "2026-10-01T00:00:00.000Z",
        },
        history: [
          {
            documentType: "terms",
            version: "1.0",
            action: "accepted",
            recordedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
    ),
  );
  render(<LegalHistory />, { wrapper: createQueryWrapper() });
  expect(await screen.findByText("利用規約（現在 第1.1版）")).toBeVisible();
  expect(screen.getByText("未同意")).toBeVisible();
  expect(screen.getByText(/2026年10月1日.*に確認/)).toBeVisible();
  expect(
    screen.getByRole("list", { name: "これまでの記録" }),
  ).toHaveTextContent("利用規約 第1.0版：2026年10月1日");
});
