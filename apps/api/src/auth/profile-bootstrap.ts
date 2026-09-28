import { createClient } from "@supabase/supabase-js";

export type VerifiedUser = { id: string; hasGoogleIdentity: boolean };
export type VerifyResult =
  | { status: "ok"; user: VerifiedUser }
  | { status: "invalid" }
  | { status: "unavailable" };

export type ProfileBootstrapDeps = {
  verifyToken: (token: string) => Promise<VerifyResult>;
  ensureProfile: (userId: string) => Promise<boolean>;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function createSupabaseProfileBootstrapDeps(): ProfileBootstrapDeps {
  const url = requiredEnv("SUPABASE_URL");
  const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
  const authClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const adminClient = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async verifyToken(token) {
      try {
        const { data, error } = await authClient.auth.getUser(token);
        if (error) {
          if ((error.status ?? 0) >= 500) return { status: "unavailable" };
          return { status: "invalid" };
        }
        if (!data.user) return { status: "invalid" };
        return {
          status: "ok",
          user: {
            id: data.user.id,
            hasGoogleIdentity:
              data.user.identities?.some(
                (identity) => identity.provider === "google",
              ) ?? false,
          },
        };
      } catch {
        return { status: "unavailable" };
      }
    },
    async ensureProfile(userId) {
      const { error } = await adminClient
        .from("profiles")
        .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
      return error === null;
    },
  };
}
