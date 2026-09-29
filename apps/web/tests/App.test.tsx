import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "../src/App";

vi.mock("../src/features/auth/auth", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
  initializeOwnProfile: vi.fn(),
  startGoogleSignIn: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("APIのステータスがOKと表示される。", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  render(<App />);

  expect(await screen.findByText(/API Status:\s*ok/i)).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "Googleでログイン" }),
  ).toBeInTheDocument();
});

test("health応答が契約違反ならエラーを表示する", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "unexpected" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  render(<App />);

  expect(await screen.findByText(/API Status:\s*error/i)).toBeInTheDocument();
});
