import { spawn } from "node:child_process";
import { z } from "zod";
import {
  WebSearchError,
  type WebSearchProvider,
  type WebSearchResult,
} from "./web-search.js";

const responseSchema = z.union([
  z.object({
    results: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string().optional(),
        }),
      )
      .max(25),
  }),
  z.object({
    error: z.enum(["blocked", "timeout", "unavailable", "invalid_request"]),
  }),
]);

export type DdgsConfig = {
  /** Python with ddgs installed (see apps/crawler/ddgs/requirements.txt). */
  python: string;
  script: string;
  region: string;
  timeoutMs: number;
};

/**
 * DDGS (DuckDuckGo backend only) behind the WebSearchProvider port. It runs
 * in the crawler worker, never in an API request. The subprocess gets no
 * secrets: only PATH and locale reach it, and only the query is sent.
 */
export function createDdgsProvider(
  config: DdgsConfig,
  run: typeof spawn = spawn,
): WebSearchProvider {
  return {
    name: "ddgs",
    search: (input) =>
      new Promise<WebSearchResult[]>((resolve, reject) => {
        const child = run(config.python, [config.script], {
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
          stdio: ["pipe", "pipe", "ignore"],
        });
        let output = "";
        let settled = false;
        const finish = (action: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          action();
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() => reject(new WebSearchError("timeout")));
        }, config.timeoutMs);
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          output += chunk;
          if (output.length > 256_000) {
            child.kill("SIGKILL");
            finish(() => reject(new WebSearchError("unavailable")));
          }
        });
        child.on("error", () =>
          finish(() => reject(new WebSearchError("unavailable"))),
        );
        child.on("close", () =>
          finish(() => {
            let parsed;
            try {
              parsed = responseSchema.parse(JSON.parse(output));
            } catch {
              reject(new WebSearchError("unavailable"));
              return;
            }
            if ("error" in parsed) {
              reject(
                new WebSearchError(
                  parsed.error === "invalid_request"
                    ? "unavailable"
                    : parsed.error,
                ),
              );
              return;
            }
            resolve(parsed.results);
          }),
        );
        child.stdin?.end(
          JSON.stringify({
            query: input.query,
            maxResults: input.maxResults,
            region: config.region,
            timeoutSeconds: Math.max(
              1,
              Math.floor(config.timeoutMs / 1_000) - 1,
            ),
          }),
        );
      }),
  };
}
