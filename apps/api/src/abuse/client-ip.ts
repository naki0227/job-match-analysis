import { isIP } from "node:net";

/**
 * Where a trustworthy client IP comes from (ADR-042). "none" means the
 * deployment cannot vouch for any header, so the IP signal is null.
 * "xff-rightmost" is for an ingress that appends the peer address it saw as
 * the last X-Forwarded-For entry (Azure Container Apps' Envoy); entries
 * before it are client-supplied and ignored.
 */
export type ClientIpSource = "none" | "xff-rightmost";

export function clientIpSourceFromEnv(
  value: string | undefined,
): ClientIpSource {
  if (value === undefined || value === "" || value === "none") return "none";
  if (value === "xff-rightmost") return value;
  throw new Error("ABUSE_CLIENT_IP_SOURCE is invalid");
}

/** Canonical text form, so one address always yields the same HMAC. */
export function canonicalIp(raw: string): string | null {
  const value = raw.trim();
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;
  const hostname = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(hostname);
  if (!mapped) return hostname;
  const high = Number.parseInt(mapped[1] ?? "", 16);
  const low = Number.parseInt(mapped[2] ?? "", 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function trustedClientIp(
  header: (name: string) => string | undefined,
  source: ClientIpSource,
): string | null {
  if (source === "none") return null;
  const entries = header("X-Forwarded-For")?.split(",") ?? [];
  const last = entries.at(-1);
  return last === undefined ? null : canonicalIp(last);
}
