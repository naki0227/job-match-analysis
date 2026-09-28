import { describe, expect, it } from "vitest";
import {
  FETCH_LIMITS,
  isPublicAddress,
  parsePublicUrl,
  resolvePublicAddress,
} from "../src/url-policy.js";

describe("public URL policy", () => {
  it("normalizes an HTTPS URL and strips its fragment", () => {
    expect(parsePublicUrl("https://EXAMPLE.com:443/jobs#section").href).toBe(
      "https://example.com/jobs",
    );
  });

  it.each([
    "http://example.com/jobs",
    "ftp://example.com/jobs",
    "https://example.com:8443/jobs",
    "https://user:password@example.com/jobs",
    "https://localhost/jobs",
    "https://job.local/jobs",
    "https://127.0.0.1/jobs",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/jobs",
    "https://[::ffff:127.0.0.1]/jobs",
    `https://example.com/${"a".repeat(FETCH_LIMITS.maxUrlChars)}`,
  ])("rejects an unsafe URL: %s", (url) => {
    expect(() => parsePublicUrl(url)).toThrow();
  });

  it.each([
    "0.0.0.1",
    "10.0.0.1",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:0a00:0001::1",
  ])("rejects a non-public address: %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts a globally reachable address: %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("rejects the whole DNS response if any address is private", async () => {
    await expect(
      resolvePublicAddress("example.com", async () => ["8.8.8.8", "10.0.0.1"]),
    ).rejects.toThrow("non-public");
    await expect(
      resolvePublicAddress("example.com", async () => []),
    ).rejects.toThrow("empty");
  });
});
