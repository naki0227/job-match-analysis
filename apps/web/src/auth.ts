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
