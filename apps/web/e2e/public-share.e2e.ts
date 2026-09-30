import { expect, test } from "@playwright/test";
import { toSharedMatch } from "@job-match/contracts";
import { sampleReport } from "../tests/fixtures/match-report";

const token = "E2eShareToken_abcdefghijklmnopqrstuvwxyz012";

test("公開リンクはログインなしで共有projectionを表示し、失効後は表示しない", async ({
  page,
}) => {
  let revoked = false;
  await page.route(`**/api/v1/public/shares/${token}`, (route) =>
    revoked
      ? route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ code: "not_found" }),
        })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sharedAt: "2026-09-29T01:00:00Z",
            projection: toSharedMatch(sampleReport),
          }),
        }),
  );

  await page.goto(`/s/${token}`);
  await expect(
    page.getByRole("heading", { name: "共有された比較結果" }),
  ).toBeVisible();
  await expect(page.getByText("サンプルテック株式会社").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Googleでログイン" }),
  ).toHaveCount(0);

  revoked = true;
  await page.reload();
  await expect(
    page.getByText("このリンクは無効か、共有が停止されました。"),
  ).toBeVisible();
});
