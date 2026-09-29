import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthenticatedApp } from "../src/AuthenticatedApp";

const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("home submission moves to the analysis screen and shows progress", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: "pending", jobId }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<AuthenticatedApp getAccessToken={async () => "token"} />);

  fireEvent.change(screen.getByLabelText("求人ページのURL"), {
    target: { value: "https://jobs.example.com/1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "分析する" }));

  expect(
    await screen.findByText("解析の順番を待っています"),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "求人を分析" })).toBeVisible();
  expect(screen.getByRole("button", { name: "求人分析" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByLabelText("求人ページのURL")).toHaveValue(
    "https://jobs.example.com/1",
  );
});

test("invalid URL is flagged without calling the API", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<AuthenticatedApp getAccessToken={async () => "token"} />);
  fireEvent.click(screen.getByRole("button", { name: "求人分析" }));
  fireEvent.change(screen.getByLabelText("求人ページのURL"), {
    target: { value: "jobs.example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "分析する" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "https:// で始まる公開求人ページのURL",
  );
  expect(screen.getByLabelText("求人ページのURL")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
