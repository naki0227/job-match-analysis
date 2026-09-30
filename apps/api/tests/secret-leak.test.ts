import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";

// Issue #29: secrets and user tokens never reach responses or console output,
// even when every backing service fails.
const markers = {
  SUPABASE_URL: "http://127.0.0.1:9/LEAK_URL_MARKER",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_LEAK_PUBLISHABLE_MARKER",
  SUPABASE_SECRET_KEY: "sb_secret_LEAK_SECRET_MARKER",
  JEV_API_KEY: "jev_LEAK_JEV_MARKER",
  ANALYZER_VERSION: "analysis-v1",
  ANALYSIS_FRESHNESS_SECONDS: "3600",
};
const userToken = "eyJhbGciOiJIUzI1NiJ9.LEAK_JWT_MARKER.signature";
const pattern = /LEAK_[A-Z]+_MARKER/;

const id = randomUUID();
const requests: Array<[string, string, string?]> = [
  ["POST", "/v1/me/profile"],
  ["GET", "/v1/me/career-profile"],
  ["PUT", "/v1/me/career-profile", "{}"],
  ["POST", "/v1/analyses", '{"url":"https://jobs.example.org/1"}'],
  ["GET", `/v1/analyses/${id}`],
  ["GET", "/v1/me/analysis-history"],
  ["POST", "/v1/matches", `{"evaluationId":"${id}"}`],
  ["GET", `/v1/me/matches/${id}`],
  ["POST", `/v1/me/matches/${id}/share`],
  ["GET", `/v1/me/matches/${id}/share`],
  ["DELETE", `/v1/me/shares/${id}`],
  ["GET", `/v1/public/shares/${"a".repeat(43)}`],
];

async function run(app: ReturnType<typeof createApp>) {
  const output: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((name) => console[name]);
  for (const name of methods) {
    console[name] = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };
  }
  try {
    for (const [method, path, body] of requests) {
      const response = await app.request(path, {
        method,
        headers: {
          Authorization: `Bearer ${userToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body } : {}),
      });
      assert.ok(
        response.status >= 400,
        `${method} ${path} -> ${response.status}`,
      );
      const text = await response.text();
      const headers = JSON.stringify([...response.headers.entries()]);
      assert.doesNotMatch(text + headers, pattern, `${method} ${path}`);
    }
  } finally {
    methods.forEach((name, index) => {
      console[name] = originals[index]!;
    });
  }
  assert.doesNotMatch(output.join("\n"), pattern);
}

test("unreachable Supabase with real clients leaks nothing", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, markers);
  try {
    await run(createApp());
  } finally {
    process.env = saved;
  }
});

test("verified callers hitting failing storage leak nothing", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, markers);
  try {
    await run(
      createApp(() => ({
        verifyToken: async () => ({
          status: "ok",
          user: { id: randomUUID(), hasGoogleIdentity: true },
        }),
        ensureProfile: async () => false,
      })),
    );
  } finally {
    process.env = saved;
  }
});
