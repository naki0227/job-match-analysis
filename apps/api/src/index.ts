import { serve } from "@hono/node-server";
import { startTelemetry } from "./telemetry/sdk.js";

// The SDK must be registered before the app creates its instruments.
const telemetry = startTelemetry("job-match-api");
const { app } = await import("./app.js");

const server = serve({
  fetch: app.fetch,
  port: 3000,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void telemetry.shutdown().finally(() => process.exit(0));
  });
}
