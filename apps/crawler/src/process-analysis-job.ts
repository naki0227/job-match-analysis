import type { Browser } from "playwright";
import type { DecisionEngine } from "./decision-engine.js";
import { evaluateSource } from "./evaluate-source.js";
import { fetchSourceDocument } from "./fetch-source-document.js";
import {
  PermanentAnalysisError,
  type AnalysisWork,
  type ClaimedAnalysisJob,
} from "./job-consumer.js";
import type { RequestOnce } from "./safe-http.js";
import type { ResolveAddresses } from "./url-policy.js";

export type AnalysisSource = {
  url: string;
  targetId?: string;
  scope: "company" | "job";
};

export type AnalysisProcessorDeps = {
  loadSource: (sourceUrlId: string) => Promise<AnalysisSource | null>;
  resolveJobTarget?: (
    job: ClaimedAnalysisJob,
    identity: { title: string; employerName: string },
  ) => Promise<string>;
  siteAllowed?: (origin: string) => Promise<boolean>;
  engine: DecisionEngine;
  maxCandidates: number;
  maxExcerptChars: number;
  browser?: Browser;
  resolve?: ResolveAddresses;
  send?: RequestOnce;
  now?: () => Date;
};

export async function processAnalysisJob(
  job: ClaimedAnalysisJob,
  renew: () => Promise<void>,
  deps: AnalysisProcessorDeps,
): Promise<AnalysisWork> {
  const source = await deps.loadSource(job.sourceUrlId);
  if (!source) throw new PermanentAnalysisError();
  const fetched = await fetchSourceDocument({
    url: source.url,
    siteApproved: async (origin) => {
      if (deps.siteAllowed && !(await deps.siteAllowed(origin)))
        throw new PermanentAnalysisError();
      return true;
    },
    browser: deps.browser,
    resolve: deps.resolve,
    send: deps.send,
    now: deps.now,
  });
  await renew();
  if (
    !source.targetId &&
    (source.scope !== "job" ||
      !fetched.document.jobIdentity ||
      !deps.resolveJobTarget)
  ) {
    throw new PermanentAnalysisError();
  }
  const result = await evaluateSource({
    sourceUrlId: job.sourceUrlId,
    document: fetched.document,
    scope: source.scope,
    engine: deps.engine,
    maxCandidates: deps.maxCandidates,
    maxExcerptChars: deps.maxExcerptChars,
  });
  await renew();
  let targetId = source.targetId;
  if (!targetId) {
    const identity = fetched.document.jobIdentity;
    const resolver = deps.resolveJobTarget;
    if (!identity || !resolver) throw new PermanentAnalysisError();
    targetId = await resolver(job, identity);
    await renew();
  }
  return { targetId, ...result };
}
