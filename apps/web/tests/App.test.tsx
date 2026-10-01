import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import App from "../src/App";
import { createQueryClient } from "../src/lib/query-client";
import { consented } from "./legal-consented";
import { createQueryWrapper } from "./render-with-query";

const session = vi.hoisted(() => ({ current: null as unknown }));
const signOut = vi.hoisted(() => vi.fn(async () => {}));
const clearLocalSession = vi.hoisted(() => vi.fn(async () => {}));
const authEvents = vi.hoisted(() => ({
  listener: null as null | ((event: string, value: unknown) => void),
  failSubscribe: false,
}));

vi.mock("../src/features/auth/auth", () => ({
  getSupabaseClient: () => {
    if (authEvents.failSubscribe) throw new Error("missing configuration");
    return {
      auth: {
        onAuthStateChange: (
          listener: (event: string, value: unknown) => void,
        ) => {
          authEvents.listener = listener;
          queueMicrotask(() => listener("INITIAL_SESSION", session.current));
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    };
  },
  initializeOwnProfile: vi.fn(async () => {}),
  startGoogleSignIn: vi.fn(),
  signOut,
  clearLocalSession,
  getCurrentAccessToken: async () => "token",
}));

afterEach(() => {
  session.current = null;
  authEvents.listener = null;
  authEvents.failSubscribe = false;
  cleanup();
  vi.unstubAllGlobals();
});

test("APIのステータスがOKと表示される。", async () => {
  vi.stubGlobal(
    "fetch",
    consented(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
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
    consented(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "unexpected" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );

  render(<App />, { wrapper: createQueryWrapper() });

  expect(await screen.findByText(/API Status:\s*error/i)).toBeInTheDocument();
});

test("auth configuration failures show the sign-in error state", async () => {
  authEvents.failSubscribe = true;
  vi.stubGlobal(
    "fetch",
    consented(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      ),
    ),
  );
  render(<App />, { wrapper: createQueryWrapper() });
  expect(
    await screen.findByRole("button", { name: "Googleでログイン" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

test("signed-in users can log out from settings", async () => {
  session.current = {
    access_token: "token",
    user: { id: "user-a", email: "sample@example.com" },
  };
  vi.stubGlobal(
    "fetch",
    consented(
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/health"
          ? new Response(JSON.stringify({ status: "ok" }), { status: 200 })
          : new Response(JSON.stringify({ code: "not_found" }), {
              status: 404,
            }),
      ),
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

test("account changes clear personal cached matches before showing the next user", async () => {
  session.current = {
    access_token: "token-a",
    user: { id: "user-a", email: "a@example.com" },
  };
  vi.stubGlobal(
    "fetch",
    consented(
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/health"
          ? new Response(JSON.stringify({ status: "ok" }), { status: 200 })
          : new Response(JSON.stringify({ code: "not_found" }), {
              status: 404,
            }),
      ),
    ),
  );
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<App />, { wrapper });
  fireEvent.click(await screen.findByRole("button", { name: "設定" }));
  fireEvent.click(screen.getByRole("tab", { name: "アカウント" }));
  expect(screen.getByText("a@example.com")).toBeInTheDocument();
  client.setQueryData(["match", "evaluation-a"], { private: "user-a" });

  await act(async () => {
    authEvents.listener?.("SIGNED_IN", {
      access_token: "token-b",
      user: { id: "user-b", email: "b@example.com" },
    });
  });
  expect(client.getQueryData(["match", "evaluation-a"])).toBeUndefined();
  fireEvent.click(await screen.findByRole("button", { name: "設定" }));
  fireEvent.click(screen.getByRole("tab", { name: "アカウント" }));
  expect(screen.getByText("b@example.com")).toBeInTheDocument();
});

test("deleting the account returns to sign-in with a confirmation", async () => {
  session.current = {
    access_token: "token",
    user: { id: "user-1", email: "sample@example.com" },
  };
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    consented(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (String(input) === "/api/health")
          return Response.json({ status: "ok" });
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        return Response.json({ code: "not_found" }, { status: 404 });
      }),
    ),
  );
  render(<App />, { wrapper: createQueryWrapper() });
  fireEvent.click(await screen.findByRole("button", { name: "あとで" }));
  fireEvent.click(screen.getByRole("button", { name: "設定" }));
  fireEvent.click(screen.getByRole("tab", { name: "アカウント" }));
  fireEvent.click(screen.getByRole("button", { name: "退会の手続きへ" }));
  fireEvent.change(screen.getByLabelText(/「退会する」と入力/), {
    target: { value: "退会する" },
  });
  fireEvent.click(screen.getByRole("button", { name: "完全に削除する" }));
  expect(
    await screen.findByText(
      "退会しました。あなたに結びつくデータを削除しました。",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Googleでログイン" }),
  ).toBeVisible();
  expect(clearLocalSession).toHaveBeenCalled();
  expect(requests).toContain("DELETE /api/v1/me");
});
