import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidAnalysisUrlError,
  normalizeAnalysisUrl,
} from "../src/analysis-url.js";

test("URL正規化はfragmentと既知の追跡パラメータだけを除く", () => {
  assert.equal(
    normalizeAnalysisUrl(
      "https://jobs.example.org/opening?job_id=42&utm_source=mail&ref=abc#details",
    ),
    "https://jobs.example.org/opening?job_id=42&ref=abc",
  );
  assert.equal(
    normalizeAnalysisUrl("https://jobs.example.org/opening?job_id=42&ref=abc"),
    "https://jobs.example.org/opening?job_id=42&ref=abc",
  );
});

test("API受付は明らかな内部宛URLと認証情報を拒否する", () => {
  for (const url of [
    "http://jobs.example.org/1",
    "https://localhost/1",
    "https://service.internal/1",
    "https://127.0.0.1/1",
    "https://[::1]/1",
    "https://name:password@jobs.example.org/1",
    "https://jobs.example.org:8443/1",
    " https://jobs.example.org/1",
    "https://jobs.example.org/1 ",
  ]) {
    assert.throws(() => normalizeAnalysisUrl(url), InvalidAnalysisUrlError);
  }
});
