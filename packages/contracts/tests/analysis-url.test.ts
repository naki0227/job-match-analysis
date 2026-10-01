import { describe, expect, it } from "vitest";
import { normalizeAnalysisUrl } from "../src/analysis-url.js";

describe("shared URL normalization", () => {
  it("drops fragments and tracking parameters only", () => {
    expect(
      normalizeAnalysisUrl(
        "https://jobs.example.com/a?id=1&utm_source=x#apply",
      ),
    ).toBe("https://jobs.example.com/a?id=1");
  });

  it("rejects http, IP literals, credentials, ports and internal names", () => {
    for (const url of [
      "http://jobs.example.com/a",
      "https://127.0.0.1/a",
      "https://169.254.169.254/latest",
      "https://[::1]/a",
      "https://user:pass@jobs.example.com/",
      "https://jobs.example.com:8443/",
      "https://localhost/",
      "https://intranet.local/",
      "https://0x7f.0.0.1/",
    ]) {
      expect(() => normalizeAnalysisUrl(url), url).toThrow();
    }
  });
});
