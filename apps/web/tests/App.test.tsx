import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "../src/App";

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
});
