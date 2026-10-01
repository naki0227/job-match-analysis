import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  JobSearchError,
  searchJob,
} from "../src/features/job-resolver/job-resolver-api";
import { JobFinder } from "../src/features/job-resolver/JobFinder";
import { createQueryWrapper } from "./render-with-query";

afterEach(cleanup);

const candidate = (title: string, id: number) => ({
  companyName: "株式会社サンプル",
  title,
  url: `https://hrmos.co/pages/sample/jobs/${id}`,
  source: "known",
  employmentTypes: [],
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderFinder(response: Response | (() => Response)) {
  const onAnalyze = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async () =>
    typeof response === "function" ? response() : response,
  );
  const view = render(
    <JobFinder
      getAccessToken={async () => "token"}
      onAnalyze={onAnalyze}
      fetcher={fetcher}
    />,
    { wrapper: createQueryWrapper() },
  );
  return { onAnalyze, fetcher, view };
}

function searchFor(company: string, role: string, employment?: string) {
  fireEvent.change(screen.getByLabelText("企業名"), {
    target: { value: company },
  });
  fireEvent.change(screen.getByLabelText("職種"), { target: { value: role } });
  if (employment) {
    fireEvent.change(screen.getByLabelText("雇用形態"), {
      target: { value: employment },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: "求人を探す" }));
}

test("searching needs both fields and sends only what the user entered", async () => {
  const { fetcher } = renderFinder(
    json({ status: "not_found", partial: false }),
  );
  expect(screen.getByRole("button", { name: "求人を探す" })).toBeDisabled();
  searchFor("  マネーフォワード ", " 法人営業 ", "new_grad");
  await screen.findByText(/見つけられませんでした/);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("/api/v1/job-resolver/search");
  expect(JSON.parse(String(init?.body))).toEqual({
    company: "マネーフォワード",
    roleQuery: "法人営業",
    employmentType: "new_grad",
  });
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
});

test("a clearly identified posting is analyzed once, without extra clicks", async () => {
  const { onAnalyze, view } = renderFinder(
    json({
      status: "resolved",
      candidate: candidate("法人営業", 1),
      reason: "single_full_match",
      partial: false,
    }),
  );
  searchFor("サンプル", "法人営業");
  await screen.findByText("この求人を分析しています。");
  await waitFor(() =>
    expect(onAnalyze).toHaveBeenCalledWith(
      "https://hrmos.co/pages/sample/jobs/1",
    ),
  );
  view.rerender(
    <JobFinder getAccessToken={async () => "token"} onAnalyze={onAnalyze} />,
  );
  expect(onAnalyze).toHaveBeenCalledTimes(1);
});

test("ambiguous results let the user pick; nothing is analyzed until then", async () => {
  const { onAnalyze } = renderFinder(
    json({
      status: "candidates",
      candidates: [
        candidate("法人営業（東京）", 1),
        candidate("法人営業（大阪）", 2),
      ],
      hasMore: false,
      partial: true,
    }),
  );
  searchFor("サンプル", "営業");
  const list = await screen.findByRole("list", { name: "求人の候補" });
  expect(onAnalyze).not.toHaveBeenCalled();
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  const link = within(items[1]!).getByRole("link", {
    name: "求人ページを開く",
  });
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(
    within(items[1]!).getByRole("button", { name: "この求人を分析する" }),
  );
  expect(onAnalyze).toHaveBeenCalledWith(
    "https://hrmos.co/pages/sample/jobs/2",
  );
  expect(screen.getByText(/結果が不完全な場合があります/)).toBeVisible();
});

test("an unavailable resolver points to direct URL input", async () => {
  renderFinder(json({ code: "service_unavailable" }, 503));
  searchFor("サンプル", "営業");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "求人URLを直接入力",
  );
});

test("the API client maps statuses and rejects malformed answers", async () => {
  const kind = async (response: Response) =>
    searchJob("t", { company: "a", roleQuery: "b" }, async () => response).then(
      () => "ok",
      (error: unknown) =>
        error instanceof JobSearchError ? error.kind : "other",
    );
  expect(await kind(json({}, 400))).toBe("invalid");
  expect(await kind(json({}, 401))).toBe("unauthorized");
  expect(await kind(json({}, 500))).toBe("unavailable");
  expect(
    await kind(
      json({
        status: "resolved",
        candidate: { ...candidate("x", 1), url: "javascript:alert(1)" },
        reason: "single_full_match",
        partial: false,
      }),
    ),
  ).toBe("unavailable");
});
