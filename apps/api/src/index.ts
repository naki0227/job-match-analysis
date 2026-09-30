import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? "3000");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

serve({
  fetch: app.fetch,
  port,
});
