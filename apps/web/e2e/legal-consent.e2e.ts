import { expect, test } from "@playwright/test";
import {
  legalDocuments,
  legalStatus,
  savedProfile,
  signInWithFixture,
} from "./session-fixture";

test("未確認の利用者は本文を読んで両方に同意・確認するまでアプリに入れず、記録後は元の状態に戻る", async ({
  page,
}) => {
  await signInWithFixture(page, { consented: false });
  let recorded: unknown = null;
  await page.route("**/api/v1/me/legal-acknowledgements", async (route) => {
    if (route.request().method() === "POST") {
      recorded = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(legalStatus("2026-10-01T09:00:00Z")),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        legalStatus(recorded ? "2026-10-01T09:00:00Z" : null),
      ),
    });
  });
  await page.route("**/api/v1/legal-documents/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(legalDocuments),
    }),
  );
  await page.route("**/api/v1/me/career-profile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(savedProfile),
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "最初に確認。" }),
  ).toBeVisible();
  await expect(page.getByLabel("求人ページのURL")).toHaveCount(0);

  await page.getByRole("button", { name: "利用規約を読む" }).click();
  await expect(page.getByRole("dialog", { name: "利用規約" })).toContainText(
    "E2E用の本文です。",
  );
  await page.getByRole("button", { name: "閉じる" }).click();

  const next = page.getByRole("button", { name: "次へ" });
  await page.getByRole("checkbox", { name: /利用規約.*同意する/ }).check();
  await expect(next).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /プライバシーポリシー.*確認した/ })
    .check();
  await next.click();

  // The saved profile is still there: the user lands on the normal home.
  await expect(page.getByLabel("企業名")).toBeVisible();
  await expect(page.getByText("求人URLを直接入力")).toBeVisible();
  expect(recorded).toEqual({
    termsDocumentId: legalDocuments.terms.id,
    privacyPolicyDocumentId: legalDocuments.privacyPolicy.id,
  });
});

test("法的文書が登録されていない時は、明示的なエラーで止まる", async ({
  page,
}) => {
  await signInWithFixture(page, { consented: false });
  await page.route("**/api/v1/me/legal-acknowledgements", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "legal_documents_unavailable" }),
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "現在利用できません" }),
  ).toBeVisible();
  await expect(page.getByLabel("求人ページのURL")).toHaveCount(0);
});
