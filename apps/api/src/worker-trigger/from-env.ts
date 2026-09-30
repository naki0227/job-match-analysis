import {
  azureJobConfigFromEnv,
  createAzureJobStarter,
} from "./azure-container-apps-job.js";
import {
  disabledWorkerTrigger,
  throttledWorkerTrigger,
  type WorkerTrigger,
} from "./worker-trigger.js";

/**
 * Local development runs the worker by hand, so without Azure settings the
 * trigger is disabled. Partial settings fail fast at startup.
 */
export function workerTriggerFromEnv(env: NodeJS.ProcessEnv): WorkerTrigger {
  const config = azureJobConfigFromEnv(env);
  if (!config) return disabledWorkerTrigger;
  const cooldownSeconds = Number(env.CRAWLER_TRIGGER_COOLDOWN_SECONDS);
  if (!Number.isSafeInteger(cooldownSeconds) || cooldownSeconds < 1) {
    throw new Error("Azure worker trigger configuration is invalid");
  }
  return throttledWorkerTrigger(
    createAzureJobStarter(config),
    cooldownSeconds * 1_000,
  );
}
