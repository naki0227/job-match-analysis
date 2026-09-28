import { expect, test } from "@playwright/test";

const versionId = "b5e4309c-5947-4d75-a47d-94b34187ad20";
const userId = "7fac714a-165e-44e9-a39a-7d65cd63767e";

test("ログイン済みfixtureで入力・保存・再読込を確認する", async ({ page }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await page.addInitScript(
    ({ session }) => {
      localStorage.setItem("sb-e2e-auth-token", JSON.stringify(session));
    },
    {
      session: {
        access_token: "fixture.access.token",
        refresh_token: "fixture-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: expiresAt,
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: { provider: "google", providers: ["google"] },
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      },
    },
  );

  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"status":"ok"}',
    }),
  );
  await page.route("**/api/v1/me/profile", (route) =>
    route.fulfill({ status: 204 }),
  );
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
  await page.getByRole("textbox", { name: "希望職種" }).fill("エンジニア");
  for (let index = 0; index < 8; index += 1) {
    await page.getByRole("button", { name: "回答する" }).first().click();
  }
  const sliders = page.getByRole("slider");
  await expect(sliders).toHaveCount(16);
  await sliders.nth(0).focus();
  await page.keyboard.press("Home");
  await sliders.nth(1).focus();
  await page.keyboard.press("End");
  await page
    .getByRole("spinbutton", { name: "最低年収（円、額面）" })
    .fill("5000000");
  await page.getByText("許容する勤務地").click();
  await page.getByRole("checkbox", { name: "東京都" }).check();
  await page
    .getByRole("checkbox", { name: "フルリモートを必須にする" })
    .check();
  await page.getByRole("button", { name: "診断を保存" }).click();
  await expect(page.getByRole("status")).toContainText("第1版を保存しました。");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "希望職種" })).toHaveValue(
    "エンジニア",
  );
  await expect(page.getByText("現在の確定版: 第1版")).toBeVisible();
  await expect(page.getByRole("slider").nth(0)).toHaveValue("0");
  await expect(page.getByRole("slider").nth(1)).toHaveValue("100");
  await expect(
    page.getByRole("checkbox", { name: "フルリモートを必須にする" }),
  ).toBeChecked();
});
