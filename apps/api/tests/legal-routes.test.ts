import assert from "node:assert/strict";
import test from "node:test";
import { createLegalRoutes } from "../src/legal-routes.js";
import {
  LegalDocumentOutdatedError,
  LegalDocumentsUnavailableError,
  createLegalRepository,
  type LegalRepository,
} from "../src/repositories/legal.js";

const terms = "46100000-0000-4000-8000-000000000001";
const privacy = "46100000-0000-4000-8000-000000000002";
const body = "# 利用規約\n秘密ではないが本文はログに出さない";

const auth = () => ({
  verifyToken: async (token: string) =>
    token.startsWith("user-")
      ? {
          status: "ok" as const,
          user: { id: token.slice(5), hasGoogleIdentity: true },
        }
      : { status: "invalid" as const },
  ensureProfile: async () => true,
});

const status = (recorded: boolean) => ({
  complete: recorded,
  terms: {
    documentId: terms,
    version: "1.0",
    recordedAt: recorded ? "2026-10-01T00:00:00.000Z" : null,
  },
  privacyPolicy: {
    documentId: privacy,
    version: "1.0",
    recordedAt: recorded ? "2026-10-01T00:00:00.000Z" : null,
  },
  history: [],
});

function fakeRepository(overrides: Partial<LegalRepository> = {}) {
  const recorded: unknown[][] = [];
  const repository: LegalRepository = {
    current: async () => ({
      terms: {
        id: terms,
        version: "1.0",
        bodyMarkdown: body,
        publishedAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
      },
      privacyPolicy: {
        id: privacy,
        version: "1.0",
        bodyMarkdown: "# PP",
        publishedAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
      },
    }),
    status: async () => status(recorded.length > 0),
    record: async (...args) => {
      recorded.push(args);
    },
    ...overrides,
  };
  return { repository, recorded };
}

const post = (
  app: ReturnType<typeof createLegalRoutes>,
  token: string,
  payload: unknown,
) =>
  app.request("/v1/me/legal-acknowledgements", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

test("current documents come from storage and are not cached", async () => {
  const { repository } = fakeRepository();
  const app = createLegalRoutes(auth, () => repository);
  const response = await app.request("/v1/legal-documents/current");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const json = (await response.json()) as { terms: { bodyMarkdown: string } };
  assert.equal(json.terms.bodyMarkdown, body);
});

test("missing documents fail closed with an operator log that has no document text", async () => {
  const lines: string[] = [];
  const { repository } = fakeRepository({
    current: async () => {
      throw new LegalDocumentsUnavailableError(["privacy_policy"]);
    },
    status: async () => {
      throw new LegalDocumentsUnavailableError(["terms", "privacy_policy"]);
    },
  });
  const app = createLegalRoutes(
    auth,
    () => repository,
    (line) => lines.push(line),
  );
  const current = await app.request("/v1/legal-documents/current");
  assert.equal(current.status, 503);
  assert.equal(
    ((await current.json()) as { code: string }).code,
    "legal_documents_unavailable",
  );
  const mine = await app.request("/v1/me/legal-acknowledgements", {
    headers: { Authorization: "Bearer user-u1" },
  });
  assert.equal(mine.status, 503);
  assert.deepEqual(lines, [
    "Legal documents unavailable: no published and effective privacy_policy",
    "Legal documents unavailable: no published and effective terms, privacy_policy",
  ]);
  assert.doesNotMatch(lines.join("\n"), /利用規約|本文/);
});

test("the recorded user is always the token's user; spoofed fields are rejected", async () => {
  const { repository, recorded } = fakeRepository();
  const app = createLegalRoutes(auth, () => repository);
  assert.equal(
    (
      await post(app, "bad", {
        termsDocumentId: terms,
        privacyPolicyDocumentId: privacy,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post(app, "user-u1", {
        termsDocumentId: terms,
        privacyPolicyDocumentId: privacy,
        userId: "u2",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(app, "user-u1", {
        termsDocumentId: terms,
        privacyPolicyDocumentId: privacy,
        action: "accepted",
      })
    ).status,
    400,
  );
  assert.equal(
    (await post(app, "user-u1", { termsDocumentId: terms })).status,
    400,
  );
  assert.equal(recorded.length, 0);
  const ok = await post(app, "user-u1", {
    termsDocumentId: terms,
    privacyPolicyDocumentId: privacy,
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(recorded, [["u1", terms, privacy]]);
  assert.equal(((await ok.json()) as { complete: boolean }).complete, true);
});

test("an outdated version answers 409 so the client reloads the current text", async () => {
  const { repository } = fakeRepository({
    record: async () => {
      throw new LegalDocumentOutdatedError();
    },
  });
  const app = createLegalRoutes(auth, () => repository);
  const response = await post(app, "user-u1", {
    termsDocumentId: terms,
    privacyPolicyDocumentId: privacy,
  });
  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "legal_document_outdated",
  );
});

test("the repository refuses an incomplete status and maps storage failures", async () => {
  const repository = createLegalRepository(async (name) =>
    name === "legal_acknowledgement_status"
      ? [
          {
            document_type: "terms",
            legal_document_id: terms,
            version: "1.0",
            recorded_at: null,
          },
        ]
      : [],
  );
  await assert.rejects(
    () => repository.status("u1"),
    LegalDocumentsUnavailableError,
  );
  const broken = createLegalRepository(async () => {
    throw new Error("connection reset");
  });
  await assert.rejects(() => broken.current(), { name: "LegalStoreError" });
});
