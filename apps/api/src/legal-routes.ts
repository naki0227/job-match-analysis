import { randomUUID } from "node:crypto";
import {
  currentLegalDocumentsSchema,
  legalAcknowledgementStatusSchema,
  recordLegalAcknowledgementsSchema,
} from "@job-match/contracts";
import { Hono } from "hono";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import {
  LegalDocumentOutdatedError,
  LegalDocumentsUnavailableError,
  createSupabaseLegalRepository,
  type LegalRepository,
} from "./repositories/legal.js";

type FailStatus = 400 | 401 | 403 | 409 | 503;

/** Operators need the cause; the document text itself is never logged. */
function logUnavailable(
  error: LegalDocumentsUnavailableError,
  log: (line: string) => void,
) {
  log(
    `Legal documents unavailable: no published and effective ${
      error.missing.length ? error.missing.join(", ") : "current version"
    }`,
  );
}

/**
 * ADR-046. Current documents are public; acknowledgements are recorded only
 * for the signed-in user (from the verified token, never the body) and only
 * for the versions that are current at that moment.
 */
export function createLegalRoutes(
  authDeps: () => ProfileBootstrapDeps,
  repository: () => LegalRepository = createSupabaseLegalRepository,
  log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
) {
  const app = new Hono();

  function failer(c: {
    json: (body: unknown, status: FailStatus) => Response;
    header: (name: string, value: string) => void;
  }) {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    c.header("Cache-Control", "no-store");
    return (code: string, message: string, status: FailStatus) =>
      c.json({ code, message, requestId }, status);
  }

  function failFor(error: unknown, fail: ReturnType<typeof failer>) {
    if (error instanceof LegalDocumentsUnavailableError) {
      logUnavailable(error, log);
      return fail(
        "legal_documents_unavailable",
        "Legal documents unavailable",
        503,
      );
    }
    if (error instanceof LegalDocumentOutdatedError) {
      return fail(
        "legal_document_outdated",
        "Legal document is not current",
        409,
      );
    }
    return fail("service_unavailable", "Service unavailable", 503);
  }

  app.get("/v1/legal-documents/current", async (c) => {
    const fail = failer(c);
    try {
      const documents = await repository().current();
      return c.json(currentLegalDocumentsSchema.parse(documents), 200);
    } catch (error) {
      return failFor(error, fail);
    }
  });

  async function caller(authorization: string | undefined) {
    const auth = await authenticate(authorization, authDeps);
    if (auth.status === "unauthorized")
      return {
        ok: false as const,
        code: "unauthorized",
        message: "Authentication required",
        status: 401 as const,
      };
    if (auth.status === "forbidden")
      return {
        ok: false as const,
        code: "google_required",
        message: "Google login required",
        status: 403 as const,
      };
    if (auth.status !== "ok")
      return {
        ok: false as const,
        code: "auth_unavailable",
        message: "Authentication unavailable",
        status: 503 as const,
      };
    return { ok: true as const, userId: auth.userId };
  }

  app.get("/v1/me/legal-acknowledgements", async (c) => {
    const fail = failer(c);
    try {
      const user = await caller(c.req.header("Authorization"));
      if (!user.ok) return fail(user.code, user.message, user.status);
      const status = await repository().status(user.userId);
      return c.json(legalAcknowledgementStatusSchema.parse(status), 200);
    } catch (error) {
      return failFor(error, fail);
    }
  });

  app.post("/v1/me/legal-acknowledgements", async (c) => {
    const fail = failer(c);
    try {
      const user = await caller(c.req.header("Authorization"));
      if (!user.ok) return fail(user.code, user.message, user.status);
      const parsed = recordLegalAcknowledgementsSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return fail("invalid_request", "Invalid acknowledgement", 400);
      // Acknowledgements reference the profile; it exists after sign-in,
      // and this keeps a first request safe if bootstrap was skipped.
      if (!(await authDeps().ensureProfile(user.userId)))
        return fail("storage_unavailable", "Profile unavailable", 503);
      const store = repository();
      await store.record(
        user.userId,
        parsed.data.termsDocumentId,
        parsed.data.privacyPolicyDocumentId,
      );
      const status = await store.status(user.userId);
      return c.json(legalAcknowledgementStatusSchema.parse(status), 200);
    } catch (error) {
      return failFor(error, fail);
    }
  });

  return app;
}
