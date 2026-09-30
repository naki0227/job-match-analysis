import { cleanup, render, screen } from "@testing-library/react";
import { toSharedMatch } from "@job-match/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { PublicSharePage } from "../src/features/share/PublicSharePage";
import { publicShareToken } from "../src/public-route";
import { sampleReport } from "./fixtures/match-report";
import { createQueryWrapper } from "./render-with-query";

const token = "q".repeat(43);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("only /s/<43-char token> paths are public share pages", () => {
  expect(publicShareToken(`/s/${token}`)).toBe(token);
  expect(publicShareToken(`/s/${token}/`)).toBe(token);
  expect(publicShareToken("/s/short")).toBeNull();
  expect(publicShareToken(`/x/${token}`)).toBeNull();
  expect(publicShareToken(`/s/${token}/extra`)).toBeNull();
});

test("the public page shows the projection without personal values", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      sharedAt: "2026-09-29T01:00:00Z",
      projection: toSharedMatch(sampleReport),
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { container } = render(<PublicSharePage token={token} />, {
    wrapper: createQueryWrapper(async () => {
      throw new Error("no session on public pages");
    }),
  });
  expect(
    await screen.findByRole("heading", { name: "共有された比較結果" }),
  ).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith(
    `/api/v1/public/shares/${token}`,
    expect.anything(),
  );
  const axes = screen.getByRole("list", { name: "軸ごとの判定" });
  expect(axes).toHaveTextContent("裁量近い");
  expect(axes).toHaveTextContent("役割の幅情報が古い");
  expect(container.textContent).not.toMatch(/%|％|適性|5000000|希望値 ?\d/);
  expect(
    screen.getByRole("link", { name: "自分の軸で比べてみる" }),
  ).toHaveAttribute("href", "/");
});

test("revoked or unknown links explain that sharing stopped", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ code: "not_found" }, { status: 404 })),
  );
  render(<PublicSharePage token={token} />, { wrapper: createQueryWrapper() });
  expect(
    await screen.findByText("このリンクは無効か、共有が停止されました。"),
  ).toBeInTheDocument();
});
