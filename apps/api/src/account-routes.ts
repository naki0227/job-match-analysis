import { randomUUID } from "node:crypto";
import { deleteAccountRequestSchema } from "@job-match/contracts";
import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";

export type AccountStore = {
  /**
   * Deletes the Supabase Auth user. Database foreign keys cascade from
   * auth.users to every personal row (ADR-038).
   */
  deleteUser: (userId: string) => Promise<void>;
};

export class AccountStoreError extends Error {
  constructor() {
    super("Account storage is unavailable");
    this.name = "AccountStoreError";
  }
}

export function createSupabaseAccountStore(): AccountStore {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new AccountStoreError();
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId, false);
      if (error) throw new AccountStoreError();
    },
  };
}

type FailStatus = 400 | 401 | 403 | 503;

export function createAccountRoutes(
  authDeps: () => ProfileBootstrapDeps,
  storeDeps: () => AccountStore = createSupabaseAccountStore,
) {
  const app = new Hono();

  app.delete("/v1/me", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (code: string, message: string, status: FailStatus) =>
      c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized")
        return fail("unauthorized", "Authentication required", 401);
      if (auth.status === "forbidden")
        return fail("google_required", "Google login required", 403);
      if (auth.status !== "ok")
        return fail("auth_unavailable", "Authentication unavailable", 503);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail("confirmation_required", "Confirmation required", 400);
      }
      if (!deleteAccountRequestSchema.safeParse(body).success)
        return fail("confirmation_required", "Confirmation required", 400);
      await storeDeps().deleteUser(auth.userId);
      return c.body(null, 204);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  return app;
}
