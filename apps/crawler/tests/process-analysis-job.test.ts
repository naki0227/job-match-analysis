import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import type { ClaimedAnalysisJob } from "../src/job-consumer.js";
import { PermanentAnalysisError } from "../src/job-consumer.js";
import { processAnalysisJob } from "../src/process-analysis-job.js";
import type { FetchedResource, RequestOnce } from "../src/safe-http.js";

const sourceUrlId = randomUUID();
const targetId = randomUUID();
const job: ClaimedAnalysisJob = {
  jobId: randomUUID(),
  sourceUrlId,
  analyzerVersion: "v1",
  attempts: 1,
  leaseUntil: "2026-09-30T01:00:00Z",
  workerToken: randomUUID(),
};
const jobText = "この求人は週2日在宅勤務が可能です。".repeat(8);

function response(url: URL, body: string): FetchedResource {
  return {
    url: url.href,
    status: 200,
    headers: {
      "content-type":
        url.pathname === "/robots.txt" ? "text/plain" : "text/html",
    },
    body: Buffer.from(body),
  };
}

describe("analysis job processor", () => {
  it("checks robots and site terms, extracts a job document, then creates a persisted evaluation payload", async () => {
    const visited: string[] = [];
    const send: RequestOnce = async (url) => {
      visited.push(url.pathname);
      return url.pathname === "/robots.txt"
        ? response(url, "User-agent: *\nAllow: /")
        : response(
            url,
            `<main data-job><h1>求人</h1><p>${jobText}</p>
              <aside data-company><p>会社はフルリモートです。</p></aside></main>`,
          );
    };
    const approved = vi.fn(
      async (origin: string) => origin === "https://jobs.example",
    );
    const renew = vi.fn(async () => undefined);
    const result = await processAnalysisJob(job, renew, {
      loadSource: async () => ({
        url: "https://jobs.example/posting/1",
        targetId,
        scope: "job",
      }),
      siteApproved: approved,
      engine: createFakeDecisionEngine(),
      maxCandidates: 16,
      maxExcerptChars: 120,
      resolve: async () => ["8.8.8.8"],
      send,
      now: () => new Date("2026-09-30T00:00:00Z"),
    });
    expect(visited).toEqual(["/robots.txt", "/posting/1"]);
    expect(approved).toHaveBeenCalledWith("https://jobs.example");
    expect(renew).toHaveBeenCalledTimes(2);
    expect(result.targetId).toBe(targetId);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      sourceUrlId,
      fetchedAt: "2026-09-30T00:00:00.000Z",
      extractorVersion: "html-v1",
    });
    expect(result.documents[0]).toHaveProperty("contentHash");
    expect(result.evaluation).toHaveProperty("axisValues");
    expect(JSON.stringify(result.documents)).toContain("[company]");
    expect(result.evaluation).toHaveProperty("evidence", []);
  });

  it("fails closed before fetching when the source or site approval is missing", async () => {
    const send = vi.fn<RequestOnce>();
    const base = {
      siteApproved: async () => false,
      engine: createFakeDecisionEngine(),
      maxCandidates: 8,
      maxExcerptChars: 120,
      send,
    };
    await expect(
      processAnalysisJob(job, async () => undefined, {
        ...base,
        loadSource: async () => null,
      }),
    ).rejects.toBeInstanceOf(PermanentAnalysisError);
    await expect(
      processAnalysisJob(job, async () => undefined, {
        ...base,
        loadSource: async () => ({
          url: "https://jobs.example/posting/1",
          targetId,
          scope: "job",
        }),
      }),
    ).rejects.toBeInstanceOf(PermanentAnalysisError);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not hand work to the commit when lease renewal fails", async () => {
    const send: RequestOnce = async (url) =>
      url.pathname === "/robots.txt"
        ? response(url, "User-agent: *\nAllow: /")
        : response(url, `<main data-job>${jobText}</main>`);
    const engine = { evaluate: vi.fn(createFakeDecisionEngine().evaluate) };
    await expect(
      processAnalysisJob(
        job,
        async () => {
          throw new Error("lease lost");
        },
        {
          loadSource: async () => ({
            url: "https://jobs.example/posting/1",
            targetId,
            scope: "job",
          }),
          siteApproved: async () => true,
          engine,
          maxCandidates: 8,
          maxExcerptChars: 120,
          resolve: async () => ["8.8.8.8"],
          send,
        },
      ),
    ).rejects.toThrow("lease lost");
    expect(engine.evaluate).not.toHaveBeenCalled();
  });
});
