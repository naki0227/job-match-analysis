import { expect, test } from "@playwright/test";
import { historyItems } from "../src/dev/fixtures";
import { savedProfile, signInWithFixture } from "./session-fixture";

test("分析済み企業を再訪し、希望職種で絞り込んで次ページを見る", async ({
  page,
}) => {
  await signInWithFixture(page);
  await page.route("**/api/v1/me/career-profile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(savedProfile),
    }),
  );
  const queries: URLSearchParams[] = [];
  await page.route("**/api/v1/me/analysis-history?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    const filtered = query.get("role") === "Backend Engineer";
    const cursor = query.get("cursor");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: cursor
          ? [historyItems[1]]
          : filtered
            ? [historyItems[0]]
            : [historyItems[0]],
        nextCursor: cursor || filtered ? null : "next-page",
      }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "分析履歴" }).click();
  await expect(
    page.getByRole("heading", { name: "分析済み企業" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "分析済み企業の一覧" }).getByRole("button"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "さらに表示" }).click();
  await expect(
    page.getByRole("list", { name: "分析済み企業の一覧" }).getByRole("button"),
  ).toHaveCount(2);
  await page.getByLabel("希望職種で絞り込む").fill("Backend Engineer");
  await page.getByRole("button", { name: "適用" }).click();
  await expect(
    page.getByRole("list", { name: "分析済み企業の一覧" }).getByRole("button"),
  ).toHaveCount(1);
  expect(queries.some((query) => query.get("cursor") === "next-page")).toBe(
    true,
  );
  expect(
    queries.some(
      (query) =>
        query.get("role") === "Backend Engineer" && !query.has("cursor"),
    ),
  ).toBe(true);
});
