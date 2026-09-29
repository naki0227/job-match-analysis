import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "../src/App";
import { createQueryWrapper } from "./render-with-query";

const session = vi.hoisted(() => ({ current: null as unknown }));
const signOut = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../src/features/auth/auth", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: session.current },
        error: null,
      }),
    },
  }),
  initializeOwnProfile: vi.fn(),
  startGoogleSignIn: vi.fn(),
  signOut,
  getCurrentAccessToken: async () => "token",
}));

afterEach(() => {
  session.current = null;
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

  render(<App />, { wrapper: createQueryWrapper() });

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

  render(<App />, { wrapper: createQueryWrapper() });

  expect(await screen.findByText(/API Status:\s*error/i)).toBeInTheDocument();
});

test("signed-in users can log out from settings", async () => {
  session.current = {
    access_token: "token",
    user: { email: "sample@example.com" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/health"
        ? new Response(JSON.stringify({ status: "ok" }), { status: 200 })
        : new Response(JSON.stringify({ code: "not_found" }), { status: 404 }),
    ),
  );
  render(<App />, { wrapper: createQueryWrapper() });
  fireEvent.click(await screen.findByRole("button", { name: "設定" }));
  expect(screen.getByRole("button", { name: "設定" })).toHaveTextContent("S");
  fireEvent.click(screen.getByRole("tab", { name: "アカウント" }));
  expect(screen.getByText("sample@example.com")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
  expect(
    await screen.findByRole("button", { name: "Googleでログイン" }),
  ).toBeInTheDocument();
  expect(signOut).toHaveBeenCalled();
});
