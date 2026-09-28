import { BlockList, isIP } from "node:net";

export const FETCH_LIMITS = Object.freeze({
  maxUrlChars: 2048,
  maxRedirects: 3,
  maxResponseBytes: 1024 * 1024,
  timeoutMs: 10_000,
});

const blockedIpv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedIpv4.addSubnet(address, prefix, "ipv4");

const allowedIpv6 = new BlockList();
allowedIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blockedIpv6.addSubnet(address, prefix, "ipv6");

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family === 6) {
    return (
      allowedIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6")
    );
  }
  return false;
}

export function parsePublicUrl(input: string): URL {
  if (input.length > FETCH_LIMITS.maxUrlChars || input.trim() !== input) {
    throw new UnsafeTargetError("invalid URL length or whitespace");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeTargetError("invalid URL");
  }
  if (url.href.length > FETCH_LIMITS.maxUrlChars) {
    throw new UnsafeTargetError("normalized URL exceeds length limit");
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new UnsafeTargetError("only HTTPS on port 443 is allowed");
  }
  if (url.username || url.password) {
    throw new UnsafeTargetError("URL credentials are not allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname))
      throw new UnsafeTargetError("non-public IP");
  } else {
    const labels = hostname.split(".");
    if (
      labels.length < 2 ||
      labels.some(
        (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
      ) ||
      ["localhost", "local", "internal", "test", "invalid"].includes(
        labels.at(-1) ?? "",
      )
    ) {
      throw new UnsafeTargetError("invalid public hostname");
    }
  }
  url.hash = "";
  return url;
}

export type ResolveAddresses = (hostname: string) => Promise<readonly string[]>;

export async function resolvePublicAddress(
  hostname: string,
  resolve: ResolveAddresses,
): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await resolve(hostname);
  if (addresses.length === 0 || addresses.some((ip) => !isPublicAddress(ip))) {
    throw new UnsafeTargetError(
      "DNS returned a non-public or empty address set",
    );
  }
  const address = addresses[0];
  if (!address) throw new UnsafeTargetError("DNS returned no address");
  const family = isIP(address);
  if (family !== 4 && family !== 6)
    throw new UnsafeTargetError("invalid DNS address");
  return { address, family };
}
