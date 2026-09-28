import { expect, test, vi } from "vitest";
import { initializeOwnProfile, startGoogleSignIn } from "../src/auth";

test("Google sign-in uses the selected redirect origin", async () => {
  const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
  await startGoogleSignIn({ signInWithOAuth }, "http://localhost:5173");
  expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: "google",
    options: { redirectTo: "http://localhost:5173" },
  });
});

test("profile initialization sends only the access token to the own-profile route", async () => {
  const requests: Array<{
    url: string;
    method: string | undefined;
    authorization: string | null;
  }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(null, { status: 204 });
  };
  await initializeOwnProfile("test.jwt.token", fetcher);
  expect(requests).toEqual([
    {
      url: "/api/v1/me/profile",
      method: "POST",
      authorization: "Bearer test.jwt.token",
    },
  ]);
});

test("profile initialization does not expose server details on failure", async () => {
  const fetcher: typeof fetch = async () =>
    new Response("private database error", { status: 503 });
  await expect(initializeOwnProfile("test.jwt.token", fetcher)).rejects.toThrow(
    "Profile initialization failed",
  );
});
