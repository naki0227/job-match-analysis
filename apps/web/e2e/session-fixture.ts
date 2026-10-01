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

export const legalDocuments = {
  terms: {
    id: "46100000-0000-4000-8000-000000000001",
    version: "1.0",
    bodyMarkdown: "# 利用規約\n\nE2E用の本文です。",
    publishedAt: "2026-09-25T00:00:00Z",
    effectiveAt: "2026-10-01T00:00:00Z",
  },
  privacyPolicy: {
    id: "46100000-0000-4000-8000-000000000002",
    version: "1.0",
    bodyMarkdown: "# プライバシーポリシー\n\nE2E用の本文です。",
    publishedAt: "2026-09-25T00:00:00Z",
    effectiveAt: "2026-10-01T00:00:00Z",
  },
};

export function legalStatus(recordedAt: string | null) {
  return {
    complete: recordedAt !== null,
    terms: {
      documentId: legalDocuments.terms.id,
      version: "1.0",
      recordedAt,
    },
    privacyPolicy: {
      documentId: legalDocuments.privacyPolicy.id,
      version: "1.0",
      recordedAt,
    },
    history: [],
  };
}

/**
 * Stores a fixture Supabase session and stubs the always-called routes. The
 * user has confirmed the current legal documents unless `consented` is false.
 */
export async function signInWithFixture(
  page: Page,
  { consented = true }: { consented?: boolean } = {},
): Promise<void> {
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
  if (consented) {
    await page.route("**/api/v1/me/legal-acknowledgements", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(legalStatus("2026-10-01T00:00:00Z")),
      }),
    );
  }
  await page.route("**/api/v1/me/profile", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/v1/me/analysis-history?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );
}
