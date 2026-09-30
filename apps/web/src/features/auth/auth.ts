import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase configuration is missing");
  }
  client = createClient(url, publishableKey);
  return client;
}

export async function startGoogleSignIn(
  auth: Pick<SupabaseClient["auth"], "signInWithOAuth">,
  redirectTo: string,
): Promise<void> {
  const { error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw new Error("Google login could not be started");
}

export async function initializeOwnProfile(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/api/v1/me/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Profile initialization failed");
}

export async function getCurrentAccessToken(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error || !data.session) throw new Error("Authentication required");
  return data.session.access_token;
}

export async function signOut(
  auth: Pick<SupabaseClient["auth"], "signOut">,
): Promise<void> {
  const { error } = await auth.signOut();
  if (error) throw new Error("Sign out failed");
}

/**
 * Forgets the session in this browser only. Used after account deletion,
 * when the server-side session no longer exists.
 */
export async function clearLocalSession(
  auth: Pick<SupabaseClient["auth"], "signOut">,
): Promise<void> {
  try {
    await auth.signOut({ scope: "local" });
  } catch {
    // The account is already gone; a stale local session is harmless to drop.
  }
}
