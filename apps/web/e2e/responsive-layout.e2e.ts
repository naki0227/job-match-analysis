import { expect, test } from "@playwright/test";

const screens = [
  "サインイン",
  "オンボーディング",
  "希望条件",
  "ホーム",
  "求人分析：完了",
  "分析済み企業",
  "インサイト",
  "設定",
] as const;

for (const width of [390, 768, 1440]) {
  test(`main screens fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#ui-preview");

    for (const name of screens) {
      await page.locator(".preview-bar select").selectOption({ label: name });
      await expect(page.locator("h1").first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(
        overflow,
        `${name} exceeds ${width}px viewport`,
      ).toBeLessThanOrEqual(1);
    }
  });
}
