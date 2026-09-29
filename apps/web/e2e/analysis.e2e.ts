import { expect, test } from "@playwright/test";
import { signInWithFixture } from "./session-fixture";

const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";
const evaluationId = "8a4d1c2e-51c1-4f4e-9f7e-6c3a1b2d4e5f";

test("求人URLを送信し、共有ジョブの完了までポーリングする", async ({
  page,
}) => {
  await signInWithFixture(page);
  const posted: unknown[] = [];
  await page.route("**/api/v1/analyses", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending", jobId }),
    });
  });
  const states = ["running", "completed"];
  await page.route(`**/api/v1/analyses/${jobId}`, async (route) => {
    const status = states.shift() ?? "completed";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        status === "completed"
          ? { status, jobId, evaluationId }
          : { status, jobId },
      ),
    });
  });

  await page.goto("/");
  await page
    .getByLabel("求人ページのURL")
    .fill("https://jobs.example.com/posting/1");
  await page.getByRole("button", { name: "分析する" }).click();

  await expect(page.getByRole("heading", { name: "求人を分析" })).toBeVisible();
  await expect(page.getByText("公開ページを確認しています")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("解析が完了しました")).toBeVisible({
    timeout: 10_000,
  });
  expect(posted).toEqual([{ url: "https://jobs.example.com/posting/1" }]);
});
