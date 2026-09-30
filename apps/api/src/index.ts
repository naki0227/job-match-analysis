import { serve } from "@hono/node-server";
import { serverPort } from "./server-port.js";
import { startTelemetry } from "./telemetry/sdk.js";

const port = serverPort(process.env.PORT);
// The SDK must be registered before the app creates its instruments.
const telemetry = startTelemetry("job-match-api");
const { app } = await import("./app.js");

const server = serve({
  fetch: app.fetch,
  port,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void telemetry.shutdown().finally(() => process.exit(0));
  });
}
