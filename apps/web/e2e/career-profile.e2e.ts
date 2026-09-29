import { expect, test } from "@playwright/test";
import { signInWithFixture } from "./session-fixture";

const versionId = "b5e4309c-5947-4d75-a47d-94b34187ad20";

test("ログイン済みfixtureで入力・保存・再読込を確認する", async ({ page }) => {
  await signInWithFixture(page);

  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/v1/me/career-profile", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: saved ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(saved ?? { code: "not_found" }),
      });
      return;
    }
    const request = route.request().postDataJSON();
    expect(request.expectedVersion).toBe(0);
    saved = {
      profileVersionId: versionId,
      profileVersion: 1,
      profile: request.profile,
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(saved),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "はじめる" }).click();
  await page.getByRole("button", { name: "Backend Engineer" }).click();
  await page.getByRole("button", { name: "次へ" }).click();
  for (let index = 0; index < 8; index += 1) {
    if (index === 0) {
      await page.getByRole("slider", { name: "希望値" }).focus();
      await page.keyboard.press("Home");
      await page.getByRole("radio", { name: "とても重視" }).check();
    } else {
      await page.getByRole("radio", { name: "ふつう" }).check();
    }
    await page.getByRole("button", { name: "次へ" }).click();
  }
  await page
    .getByRole("spinbutton", { name: "最低年収（円、額面）" })
    .fill("5000000");
  await page.getByText("許容する勤務地").click();
  await page.getByRole("checkbox", { name: "東京都" }).check();
  await page
    .getByRole("checkbox", { name: "フルリモートを必須にする" })
    .check();
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("希望条件の第1版を保存しました")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "見直す" }).click();
  await expect(page.getByText(/現在の確定版: 第1版/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Backend Engineer" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("slider", { name: "希望値" })).toHaveValue("0");
  await expect(page.getByRole("radio", { name: "とても重視" })).toBeChecked();
  expect(saved?.profile).toMatchObject({
    constraints: {
      minSalary: { amount: 5_000_000 },
      allowedPrefectureCodes: ["13"],
      fullRemoteRequired: true,
    },
  });
});
