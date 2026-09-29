import type { Page } from "@playwright/test";

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
