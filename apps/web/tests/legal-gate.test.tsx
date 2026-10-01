import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { sampleLegalDocuments } from "../src/dev/fixtures";
import { LegalGate } from "../src/features/legal/LegalGate";
import { createQueryWrapper } from "./render-with-query";

afterEach(cleanup);

const { terms, privacyPolicy } = sampleLegalDocuments;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const status = (
  termsAt: string | null,
  privacyAt: string | null,
  termsDoc = terms,
) => ({
  complete: termsAt !== null && privacyAt !== null,
  terms: {
    documentId: termsDoc.id,
    version: termsDoc.version,
    recordedAt: termsAt,
  },
  privacyPolicy: {
    documentId: privacyPolicy.id,
    version: privacyPolicy.version,
    recordedAt: privacyAt,
  },
  history: [],
});

function renderGate(handler: (path: string, init?: RequestInit) => Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    return handler(path, init);
  });
  render(
    <LegalGate onSignOut={async () => {}} fetcher={fetcher}>
      <p>アプリ本体</p>
    </LegalGate>,
    { wrapper: createQueryWrapper() },
  );
  return calls;
}

function confirmBoth() {
  fireEvent.click(screen.getByRole("checkbox", { name: /利用規約.*同意する/ }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: /プライバシーポリシー.*確認した/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "次へ" }));
}

test("users who already confirmed the current versions go straight in", async () => {
  const calls = renderGate(() =>
    json(status("2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")),
  );
  expect(await screen.findByText("アプリ本体")).toBeVisible();
  expect(calls.map((call) => call.path)).toEqual([
    "/api/v1/me/legal-acknowledgements",
  ]);
});

test("a user without a record must confirm both, and the record is sent to the server", async () => {
  let recorded = false;
  const calls = renderGate((path, init) => {
    if (path === "/api/v1/legal-documents/current")
      return json(sampleLegalDocuments);
    if (init?.method === "POST") {
      recorded = true;
      return json(status("2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"));
    }
    return json(recorded ? status("t", "t") : status(null, null));
  });
  await screen.findByRole("heading", { name: "最初に確認。" });
  expect(screen.queryByText("アプリ本体")).toBeNull();
  confirmBoth();
  expect(await screen.findByText("アプリ本体")).toBeVisible();
  const post = calls.find((call) => call.init?.method === "POST")!;
  expect(JSON.parse(String(post.init?.body))).toEqual({
    termsDocumentId: terms.id,
    privacyPolicyDocumentId: privacyPolicy.id,
  });
  expect(new Headers(post.init?.headers).get("Authorization")).toBe(
    "Bearer token",
  );
});

test("after a terms update an earlier acceptance is not enough", async () => {
  const newTerms = {
    ...terms,
    id: "46100000-0000-4000-8000-000000000005",
    version: "1.1",
  };
  renderGate((path) =>
    path === "/api/v1/legal-documents/current"
      ? json({ terms: newTerms, privacyPolicy })
      : json(status(null, "2026-10-01T00:00:00Z", newTerms)),
  );
  expect(
    await screen.findByText(/第1.1版/, { selector: "span" }),
  ).toBeVisible();
  expect(screen.queryByText("アプリ本体")).toBeNull();
});

test("a version that changed while reading asks for a new confirmation", async () => {
  renderGate((path, init) => {
    if (path === "/api/v1/legal-documents/current")
      return json(sampleLegalDocuments);
    if (init?.method === "POST")
      return json({ code: "legal_document_outdated" }, 409);
    return json(status(null, null));
  });
  await screen.findByRole("heading", { name: "最初に確認。" });
  confirmBoth();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "文書が更新されました",
  );
  expect(screen.queryByText("アプリ本体")).toBeNull();
});

test("missing documents fail closed with an explicit message, not a spinner", async () => {
  let attempts = 0;
  renderGate(() => {
    attempts += 1;
    return json({ code: "legal_documents_unavailable" }, 503);
  });
  expect(
    await screen.findByRole("heading", { name: "現在利用できません" }),
  ).toBeVisible();
  expect(screen.queryByText("アプリ本体")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
  await waitFor(() => expect(attempts).toBe(2));
});
