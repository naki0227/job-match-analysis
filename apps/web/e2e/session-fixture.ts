import type { Page } from "@playwright/test";

const axisKeys = [
  "work_location",
  "autonomy",
  "collaboration",
  "growth_direction",
  "work_change",
  "schedule_flexibility",
  "role_breadth",
  "customer_contact",
];

/** A saved profile so signed-in screens skip onboarding. */
export const savedProfile = {
  profileVersionId: "b5e4309c-5947-4d75-a47d-94b34187ad20",
  profileVersion: 1,
  profile: {
    axisCatalogVersion: 1,
    targetRoles: ["Backend Engineer"],
    axisValues: axisKeys.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: 50,
      importance: 50,
    })),
    constraints: { allowedPrefectureCodes: [], fullRemoteRequired: false },
  },
};

const userId = "7fac714a-165e-44e9-a39a-7d65cd63767e";

/** Stores a fixture Supabase session and stubs the always-called routes. */
export async function signInWithFixture(page: Page): Promise<void> {
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
}
