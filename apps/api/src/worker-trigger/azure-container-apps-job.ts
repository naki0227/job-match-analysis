import { z } from "zod";

/**
 * Starts an Azure Container Apps Job execution with the API's managed
 * identity (ADR-040). Uses the Container Apps identity endpoint and the ARM
 * REST API directly, so no Azure SDK or credential reaches other layers.
 * The identity needs only Microsoft.App/jobs/start/action on this job.
 */
export type AzureJobConfig = {
  subscriptionId: string;
  resourceGroup: string;
  jobName: string;
  identityEndpoint: string;
  identityHeader: string;
};

const ARM = "https://management.azure.com";
const API_VERSION = "2025-01-01";
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_on: z.coerce.number(),
});
const namePattern = /^[-\w.()]+$/;

export class AzureJobStartError extends Error {
  constructor() {
    super("Azure job start failed");
    this.name = "AzureJobStartError";
  }
}

export function azureJobConfigFromEnv(
  env: NodeJS.ProcessEnv,
): AzureJobConfig | null {
  const config = {
    subscriptionId: env.AZURE_SUBSCRIPTION_ID ?? "",
    resourceGroup: env.AZURE_RESOURCE_GROUP ?? "",
    jobName: env.CRAWLER_AZURE_JOB_NAME ?? "",
    identityEndpoint: env.IDENTITY_ENDPOINT ?? "",
    identityHeader: env.IDENTITY_HEADER ?? "",
  };
  if (Object.values(config).every((value) => value === "")) return null;
  if (
    !z.uuid().safeParse(config.subscriptionId).success ||
    !namePattern.test(config.resourceGroup) ||
    !namePattern.test(config.jobName) ||
    !config.identityEndpoint ||
    !config.identityHeader
  ) {
    throw new Error("Azure worker trigger configuration is invalid");
  }
  return config;
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
      response = await fetcher(
        `${ARM}/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.App/jobs/${config.jobName}/start?api-version=${API_VERSION}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await token()}`,
            "Content-Type": "application/json",
          },
          body: "{}",
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
