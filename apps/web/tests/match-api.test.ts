import { expect, test } from "vitest";
import { MatchApiError, requestMatch } from "../src/features/result/match-api";
import { jobEvaluationId, sampleReport } from "./fixtures/match-report";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MatchApiError) return error.kind;
    throw error;
  }
  throw new Error("expected rejection");
}

test("POST sends only the evaluation ID and validates the report", async () => {
  let body: unknown;
  let url = "";
  const report = await requestMatch(
    "token",
    jobEvaluationId,
    async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer token",
      );
      return json(sampleReport, 201);
    },
  );
  expect(url).toBe("/api/v1/matches");
  expect(body).toEqual({ evaluationId: jobEvaluationId });
  expect(report.companyName).toBe("サンプルテック株式会社");
});

test.each([
  [401, "unauthorized"],
  [404, "not_found"],
  [409, "profile_required"],
  [422, "not_comparable"],
  [503, "unavailable"],
] as const)("HTTP %i maps to %s", async (status, kind) => {
  expect(
    await kindOf(
      requestMatch("t", jobEvaluationId, async () =>
        json({ code: "x", message: "detail", requestId: "r" }, status),
      ),
    ),
  ).toBe(kind);
});

test("contract violations, other evaluations and network errors are unavailable", async () => {
  for (const fetcher of [
    async () => json({ ...sampleReport, score: 80 }),
    async () =>
      json({
        ...sampleReport,
        job: { ...sampleReport.job, evaluationId: sampleReport.matchResultId },
      }),
    async () => {
      throw new TypeError("offline");
    },
  ]) {
    expect(await kindOf(requestMatch("t", jobEvaluationId, fetcher))).toBe(
      "unavailable",
    );
  }
});
