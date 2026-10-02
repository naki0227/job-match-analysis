import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  consumeOneAnalysisJob,
  type AnalysisJobStore,
} from "../src/job-consumer.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import { processAnalysisJob } from "../src/process-analysis-job.js";
import type { FetchedResource, RequestOnce } from "../src/safe-http.js";

const execFileAsync = promisify(execFile);
const container = process.env.JOB_MATCH_DB_CONTAINER;
if (!container) throw new Error("JOB_MATCH_DB_CONTAINER is required");

const sourceId = "20000000-0000-4000-8000-000000000020";
const jobId = "20000000-0000-4000-8000-000000000023";
const url = "https://example.org/issue20-process-recovery";

async function query(statement: string): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "exec",
    container!,
    "psql",
    "-X",
    "-q",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    statement,
  ]);
  return stdout.trim();
}

function uuid(value: string): string {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  return value;
}

function json(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

const jobText = "週2日在宅勤務が可能な公開求人です。".repeat(8);
const send: RequestOnce = async (requestedUrl) => {
  const robots = requestedUrl.pathname === "/robots.txt";
  const body = robots
    ? "User-agent: *\nAllow: /"
    : `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "公開求人",
        hiringOrganization: { name: "Issue 20 Process Recovery" },
      })}</script><main data-job><h1>公開求人</h1>
        <p>年収500万円〜800万円</p><p>週2日出社</p><p>${jobText}</p>
        <aside data-company><p>会社全体ではフルリモートです。</p></aside></main>`;
  const response: FetchedResource = {
    url: requestedUrl.href,
    status: 200,
    headers: { "content-type": robots ? "text/plain" : "text/html" },
    body: Buffer.from(body),
  };
  return response;
};

const store: AnalysisJobStore = {
  async claim(workerToken, leaseSeconds, maxAttempts) {
    const result = await query(`select row_to_json(r)::text from
      public.claim_analysis_job('${uuid(workerToken)}', ${leaseSeconds}, ${maxAttempts}) r`);
    if (!result) return null;
    const claimed = JSON.parse(result) as {
      job_id: string;
      source_url_id: string;
      analyzer_version: string;
      attempts: number;
      lease_until: string;
    };
    return {
      jobId: claimed.job_id,
      sourceUrlId: claimed.source_url_id,
      analyzerVersion: claimed.analyzer_version,
      attempts: claimed.attempts,
      leaseUntil: claimed.lease_until,
      workerToken,
    };
  },
  async renew(id, token, leaseSeconds) {
    return (
      (await query(`select public.renew_analysis_job_lease(
        '${uuid(id)}', '${uuid(token)}', ${leaseSeconds})`)) === "t"
    );
  },
  async fail(id, token) {
    return (
      (await query(`select public.fail_analysis_job(
        '${uuid(id)}', '${uuid(token)}')`)) === "t"
    );
  },
  async requeue(id, token) {
    return (
      (await query(`select public.requeue_analysis_job(
        '${uuid(id)}', '${uuid(token)}')`)) === "t"
    );
  },
  async complete(id, token, result) {
    return query(`select public.commit_analysis_evaluation_v2(
      '${uuid(id)}', '${uuid(token)}', '${uuid(result.targetId)}',
      ${json(result.documents)}, ${json(result.evaluation)})`);
  },
};

async function runWorker(mode: "hold" | "recover"): Promise<void> {
  const result = await consumeOneAnalysisJob({
    store,
    leaseSeconds: mode === "hold" ? 1 : 10,
    maxAttempts: 2,
    process: async (job, renew) => {
      assert.equal(job.jobId, jobId);
      if (mode === "hold") {
        process.stdout.write("CLAIMED\n");
        await new Promise<never>(() => undefined);
      }
      assert.equal(job.attempts, 2);
      return processAnalysisJob(job, renew, {
        loadSource: async (id) => {
          assert.equal(id, sourceId);
          return { url, scope: "job" };
        },
        resolveJobTarget: async (claimed, identity) => {
          assert.deepEqual(identity, {
            title: "公開求人",
            employerName: "Issue 20 Process Recovery",
          });
          return query(`select public.resolve_job_evaluation_target(
            '${uuid(claimed.jobId)}', '${uuid(claimed.workerToken)}',
            '公開求人', 'Issue 20 Process Recovery')`);
        },
        siteAllowed: async (origin) => origin === "https://example.org",
        engine: createFakeDecisionEngine(),
        limits: {
          maxFragmentChars: 200,
        },
        resolve: async () => ["8.8.8.8"],
        send,
        now: () => new Date("2026-09-30T00:00:00Z"),
      });
    },
  });
  if (mode === "recover") {
    assert.equal(result.status, "completed");
    process.stdout.write("RECOVERED\n");
  }
}

async function waitForClaim(child: ReturnType<typeof spawn>): Promise<void> {
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("worker claim timed out")),
      10_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes("CLAIMED")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("worker exited before claim"));
    });
  });
}

async function main(): Promise<void> {
  await query(`insert into public.source_urls(id, raw_url, normalized_url)
    values ('${sourceId}', '${url}', '${url}');
    insert into public.analysis_jobs(id, source_url_id, analyzer_version, status)
    values ('${jobId}', '${sourceId}', 'issue20-process-v1', 'queued')`);

  const script = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ["--import", "tsx", script, "hold"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForClaim(child);
  } finally {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  await runWorker("recover");
  assert.equal(
    await query(`select status || ':' || attempts from public.analysis_jobs
      where id = '${jobId}'`),
    "completed:2",
  );
  assert.equal(
    await query(`select count(*) from public.evaluations e
      join public.analysis_jobs j on j.evaluation_id = e.id
      where j.id = '${jobId}'`),
    "1",
  );
  assert.equal(
    await query(`select count(*) from public.source_document_versions
      where source_url_id = '${sourceId}'
        and extractor_version = 'html-v2'
        and extracted_text like '%[job]%'
        and extracted_text like '%[company]%'`),
    "1",
  );
  assert.equal(
    await query(`select count(*) from public.evaluated_axis_values a
      join public.analysis_jobs j on j.evaluation_id = a.evaluation_id
      where j.id = '${jobId}'`),
    "8",
  );
  assert.equal(
    await query(`select count(*) from public.evaluated_axis_values a
      join public.analysis_jobs j on j.evaluation_id = a.evaluation_id
      where j.id = '${jobId}' and a.axis_key = 'work_location'
        and a.evaluation_method = 'rule' and a.anchor_value = 50`),
    "1",
  );
  assert.equal(
    await query(`select count(*) from public.evaluation_job_facts f
      join public.analysis_jobs j on j.evaluation_id = f.evaluation_id
      where j.id = '${jobId}' and f.kind = 'salary'
        and f.payload ->> 'status' = 'known'`),
    "1",
  );
  assert.equal(
    await query(`select count(*) from public.analysis_jobs j
      join public.evaluations e on e.id = j.evaluation_id
      join public.evaluation_targets t on t.id = e.target_id
      join public.job_postings p on p.id = t.job_posting_id
      join public.companies c on c.id = p.company_id
      where j.id = '${jobId}' and p.source_url_id = '${sourceId}'
        and p.title = '公開求人' and c.name = 'Issue 20 Process Recovery'`),
    "1",
  );
  process.stdout.write("killed worker was reclaimed and completed once\n");
}

const mode = process.argv[2];
if (mode === "hold" || mode === "recover") await runWorker(mode);
else await main();
