import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  consumeOneAnalysisJob,
  type AnalysisJobStore,
  type AnalysisWork,
} from "../src/job-consumer.js";
import { PUBLIC_AXIS_RUBRICS } from "../src/assessment-rubric.js";

const execFileAsync = promisify(execFile);
const container = process.env.JOB_MATCH_DB_CONTAINER;
if (!container) throw new Error("JOB_MATCH_DB_CONTAINER is required");

const sourceId = "20000000-0000-4000-8000-000000000020";
const companyId = "20000000-0000-4000-8000-000000000021";
const targetId = "20000000-0000-4000-8000-000000000022";
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

const work: AnalysisWork = {
  targetId,
  documents: [
    {
      sourceUrlId: sourceId,
      contentHash: "issue20-process-recovery-content",
      fetchedAt: "2026-09-29T00:00:00Z",
      extractorVersion: "html-v1",
      extractedText: "[job] Process recovery fixture",
    },
  ],
  evaluation: {
    axisCatalogVersion: 1,
    sourceSetHash: "issue20-process-recovery-source",
    rubricVersion: "public-anchors-v1",
    evaluatorVersion: "fake-choice-v1",
    modelVersion: "fake",
    axisValues: PUBLIC_AXIS_RUBRICS.map(({ axisKey }) => ({
      axisKey,
      axisVersion: 1,
      observationStatus: "unknown",
      anchorValue: null,
    })),
    evidence: [],
  },
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
  async complete(id, token, result) {
    return query(`select public.commit_analysis_evaluation(
      '${uuid(id)}', '${uuid(token)}', '${uuid(result.targetId)}',
      ${json(result.documents)}, ${json(result.evaluation)})`);
  },
};

async function runWorker(mode: "hold" | "recover"): Promise<void> {
  const result = await consumeOneAnalysisJob({
    store,
    leaseSeconds: mode === "hold" ? 1 : 10,
    maxAttempts: 2,
    process: async (job) => {
      assert.equal(job.jobId, jobId);
      if (mode === "hold") {
        process.stdout.write("CLAIMED\n");
        await new Promise<never>(() => undefined);
      }
      assert.equal(job.attempts, 2);
      return work;
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
    insert into public.companies(id, name)
    values ('${companyId}', 'Issue 20 Process Recovery');
    insert into public.evaluation_targets(id, target_type, company_id)
    values ('${targetId}', 'company', '${companyId}');
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
  process.stdout.write("killed worker was reclaimed and completed once\n");
}

const mode = process.argv[2];
if (mode === "hold" || mode === "recover") await runWorker(mode);
else await main();
