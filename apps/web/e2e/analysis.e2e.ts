import { expect, test } from "@playwright/test";
import { historyItems } from "../src/dev/fixtures";
import { sampleReport } from "../tests/fixtures/match-report";
import { savedProfile, signInWithFixture } from "./session-fixture";

const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";
const evaluationId = sampleReport.job.evaluationId;

test("求人URLを送信し、共有ジョブの完了後に本人の比較結果を表示する", async ({
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

  await page.route("**/api/v1/me/career-profile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(savedProfile),
    }),
  );
  const matchRequests: unknown[] = [];
  await page.route("**/api/v1/matches", async (route) => {
    matchRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(sampleReport),
    });
  });
  await page.route("**/api/v1/me/analysis-history?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: matchRequests.length
          ? [
              {
                ...historyItems[0],
                matchResultId: sampleReport.matchResultId,
                jobEvaluationId: evaluationId,
              },
            ]
          : [],
        nextCursor: null,
      }),
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  await expect(
    page.getByRole("heading", { name: "サンプルテック株式会社" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "この求人について" }),
  ).toBeVisible();
  expect(posted).toEqual([{ url: "https://jobs.example.com/posting/1" }]);
  expect(matchRequests).toEqual([{ evaluationId }]);
  await page.getByRole("button", { name: "分析履歴" }).click();
  await expect(
    page.getByRole("list", { name: "分析済み企業の一覧" }).getByRole("button", {
      name: /サンプルテック株式会社/,
    }),
  ).toBeVisible();
});

test("解析中にホームへ戻っても完了後の履歴が自動更新される", async ({
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
  await page.route("**/api/v1/analyses", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending", jobId }),
    }),
  );
  let completed = false;
  let polls = 0;
  await page.route(`**/api/v1/analyses/${jobId}`, (route) => {
    polls += 1;
    completed = polls >= 2;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        completed
          ? { status: "completed", jobId, evaluationId }
          : { status: "running", jobId },
      ),
    });
  });
  await page.route("**/api/v1/me/analysis-history?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: completed ? [historyItems[0]] : [],
        nextCursor: null,
      }),
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("求人ページのURL")
    .fill("https://jobs.example.com/posting/1");
  await page.getByRole("button", { name: "分析する" }).click();
  await expect(page.getByText("公開ページを確認しています")).toBeVisible();
  await page.getByRole("button", { name: "ホーム" }).click();
  await expect(
    page
      .getByRole("list", { name: "最近の分析" })
      .getByRole("button", { name: /サンプルテック株式会社/ }),
  ).toBeVisible({ timeout: 10_000 });
});

test("バックグラウンド中にサーバー側で完了した解析が、画面に戻るとすぐ反映される", async ({
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
  await page.route("**/api/v1/analyses", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending", jobId }),
    }),
  );
  let serverDone = false;
  const polls: number[] = [];
  await page.route(`**/api/v1/analyses/${jobId}`, (route) => {
    polls.push(Date.now());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        serverDone
          ? { status: "completed", jobId, evaluationId }
          : { status: "queued", jobId },
      ),
    });
  });
  await page.route("**/api/v1/matches", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(sampleReport),
    }),
  );
  await page.route("**/api/v1/me/analysis-history?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("求人ページのURL")
    .fill("https://jobs.example.com/posting/1");
  await page.getByRole("button", { name: "分析する" }).click();
  await expect(page.getByText("解析の順番を待っています")).toBeVisible();

  // Emulates a mobile browser putting the tab in the background.
  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((next) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => next,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      if (next === "visible") {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("pageshow"));
      }
    }, state);
  await setVisibility("hidden");
  const pollsWhenHidden = polls.length;
  await page.waitForTimeout(4_000);
  expect(polls.length).toBeLessThanOrEqual(pollsWhenHidden + 1);
  serverDone = true;

  const returnedAt = Date.now();
  await setVisibility("visible");
  await expect(page.getByText("解析が完了しました")).toBeVisible({
    timeout: 3_000,
  });
  expect(Date.now() - returnedAt).toBeLessThan(3_000);
  expect(polls.filter((at) => at >= returnedAt).length).toBeLessThanOrEqual(2);
});

test("企業名と職種で求人を探し、候補から選んだ求人を分析する", async ({
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
  const searches: unknown[] = [];
  await page.route("**/api/v1/job-resolver/search", async (route) => {
    searches.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "candidates",
        candidates: ["tokyo", "osaka"].map((city) => ({
          companyName: "サンプル株式会社",
          title: `法人営業（${city === "tokyo" ? "東京" : "大阪"}）`,
          url: `https://jobs.example.com/posting/${city}`,
          source: "known",
          employmentTypes: [],
        })),
        hasMore: false,
        partial: false,
      }),
    });
  });
  const posted: unknown[] = [];
  await page.route("**/api/v1/analyses", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "completed",
        evaluationId,
        sourceFetchedAt: "2026-09-30T00:00:00Z",
      }),
    });
  });
  await page.route("**/api/v1/matches", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(sampleReport),
    }),
  );
  await page.route("**/api/v1/me/analysis-history?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /企業名と職種から探す/ }).click();
  await page.getByLabel("企業名").fill("サンプル");
  await page.getByLabel("職種", { exact: true }).fill("法人営業");
  await page.getByRole("button", { name: "求人を探す" }).click();
  const list = page.getByRole("list", { name: "求人の候補" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  expect(posted).toEqual([]);
  await list
    .getByRole("listitem")
    .nth(1)
    .getByRole("button", { name: "この求人を分析する" })
    .click();
  await expect(
    page.getByRole("heading", { name: "解析済みの共有評価が見つかりました" }),
  ).toBeVisible({ timeout: 10_000 });
  expect(searches).toEqual([{ company: "サンプル", roleQuery: "法人営業" }]);
  expect(posted).toEqual([{ url: "https://jobs.example.com/posting/osaka" }]);
});
