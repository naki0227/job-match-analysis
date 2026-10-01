import { z } from "zod";

/**
 * Starts an Azure Container Apps Job execution with the API's managed
 * identity (ADR-040). Uses only Microsoft.App/jobs/start/action.
 *
 * The start operation accepts a per-execution template. Production uses it
 * to pin the crawler image digest and runtime settings without granting the
 * GitHub deploy identity Microsoft.App/jobs/write on the Job resource.
 */
export type AzureJobConfig = {
  subscriptionId: string;
  resourceGroup: string;
  jobName: string;
  identityEndpoint: string;
  identityHeader: string;
  execution: {
    image: string;
    environment: Array<
      { name: string; value: string } | { name: string; secretRef: string }
    >;
  } | null;
};

const ARM = "https://management.azure.com";
const API_VERSION = "2025-01-01";
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_on: z.coerce.number(),
});
const namePattern = /^[-\w.()]+$/;
const imagePattern =
  /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.\/-]+@sha256:[0-9a-f]{64}$/;

const executionValues = [
  "CRAWLER_DRAIN_MAX_JOBS",
  "CRAWLER_LEASE_SECONDS",
  "CRAWLER_MAX_ATTEMPTS",
  "CRAWLER_RETENTION_BATCH_SIZE",
  "CRAWLER_JEV_MAX_FRAGMENTS",
  "CRAWLER_JEV_MAX_CONTEXT_CHARS",
  "CRAWLER_MAX_EXCERPT_CHARS",
  "CRAWLER_MAX_EVIDENCE_PER_AXIS",
  "CRAWLER_POLL_INTERVAL_MS",
  "CRAWLER_JEV_DAILY_CANDIDATE_BUDGET",
  "CRAWLER_WEB_SEARCH_PROVIDER",
  "CRAWLER_DDGS_REGION",
  "CRAWLER_DDGS_TIMEOUT_MS",
  "CRAWLER_DISCOVERY_MAX_QUERIES",
  "CRAWLER_DISCOVERY_RESULTS_PER_QUERY",
  "CRAWLER_DISCOVERY_MAX_FETCHES",
  "CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING",
  "CRAWLER_DISCOVERY_MAX_RESULTS",
] as const;

export class AzureJobStartError extends Error {
  constructor() {
    super("Azure job start failed");
    this.name = "AzureJobStartError";
  }
}

export function azureJobConfigFromEnv(
  env: NodeJS.ProcessEnv,
): AzureJobConfig | null {
  const base = {
    subscriptionId: env.AZURE_SUBSCRIPTION_ID ?? "",
    resourceGroup: env.AZURE_RESOURCE_GROUP ?? "",
    jobName: env.CRAWLER_AZURE_JOB_NAME ?? "",
    identityEndpoint: env.IDENTITY_ENDPOINT ?? "",
    identityHeader: env.IDENTITY_HEADER ?? "",
  };
  if (Object.values(base).every((value) => value === "")) return null;
  if (
    !z.uuid().safeParse(base.subscriptionId).success ||
    !namePattern.test(base.resourceGroup) ||
    !namePattern.test(base.jobName) ||
    !base.identityEndpoint ||
    !base.identityHeader
  ) {
    throw new Error("Azure worker trigger configuration is invalid");
  }

  const image = env.CRAWLER_EXECUTION_IMAGE ?? "";
  const supabaseSecretRef = env.CRAWLER_SUPABASE_SECRET_REF ?? "";
  const jevSecretRef = env.CRAWLER_JEV_SECRET_REF ?? "";
  const supabaseUrl = env.SUPABASE_URL ?? "";
  const anyExecutionConfig =
    image !== "" ||
    supabaseSecretRef !== "" ||
    jevSecretRef !== "" ||
    executionValues.some((name) => Boolean(env[name]));

  let execution: AzureJobConfig["execution"] = null;
  if (anyExecutionConfig) {
    if (
      !imagePattern.test(image) ||
      !namePattern.test(supabaseSecretRef) ||
      !namePattern.test(jevSecretRef) ||
      !z.url().safeParse(supabaseUrl).success ||
      executionValues.some((name) => !env[name])
    ) {
      throw new Error("Azure crawler execution configuration is invalid");
    }
    execution = {
      image,
      environment: [
        { name: "SUPABASE_URL", value: supabaseUrl },
        { name: "SUPABASE_SECRET_KEY", secretRef: supabaseSecretRef },
        { name: "JEV_API_KEY", secretRef: jevSecretRef },
        { name: "CRAWLER_RUN_MODE", value: "drain" },
        ...executionValues.map((name) => ({ name, value: env[name]! })),
      ],
    };
  }

  return { ...base, execution };
}

export function createAzureJobStarter(
  config: AzureJobConfig,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): () => Promise<void> {
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt - 300_000 > now()) return cached.token;
    const url = new URL(config.identityEndpoint);
    url.searchParams.set("resource", `${ARM}/`);
    url.searchParams.set("api-version", "2019-08-01");
    const response = await fetcher(url, {
      headers: { "X-IDENTITY-HEADER": config.identityHeader },
    });
    if (!response.ok) throw new AzureJobStartError();
    const parsed = tokenSchema.safeParse(await response.json());
    if (!parsed.success) throw new AzureJobStartError();
    cached = {
      token: parsed.data.access_token,
      expiresAt: parsed.data.expires_on * 1_000,
    };
    return cached.token;
  }

  return async () => {
    let response: Response;
    try {
      const body = config.execution
        ? JSON.stringify({
            containers: [
              {
                name: config.jobName,
                image: config.execution.image,
                resources: { cpu: 1, memory: "2Gi" },
                env: config.execution.environment,
              },
            ],
          })
        : "{}";
      response = await fetcher(
        `${ARM}/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.App/jobs/${config.jobName}/start?api-version=${API_VERSION}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await token()}`,
            "Content-Type": "application/json",
          },
          body,
        },
      );
    } catch {
      throw new AzureJobStartError();
    }
    if (response.status !== 200 && response.status !== 202) {
      if (response.status === 401) cached = null;
      throw new AzureJobStartError();
    }
  };
}
