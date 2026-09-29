import {
  fetchPublic,
  requestOnce,
  systemResolver,
  type FetchedResource,
} from "./safe-http.js";
import { parsePublicUrl } from "./url-policy.js";

const crawlerAgent = "jobmatchcrawler";

export class CrawlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlPolicyError";
  }
}

type Rule = { allow: boolean; path: string };
type Group = { agents: string[]; rules: Rule[] };

function normalizePath(path: string): string {
  return path.replace(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return /[A-Za-z0-9._~-]/.test(String.fromCharCode(code))
      ? String.fromCharCode(code)
      : encoded.toUpperCase();
  });
}

function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const pattern = anchored ? rule.slice(0, -1) : rule;
  const escaped = normalizePath(pattern)
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
}

export function robotsAllows(body: string, target: URL): boolean {
  const groups: Group[] = [];
  let group: Group | undefined;
  let hasRules = false;
  for (const line of body.split(/\r?\n/)) {
    const record = line.split("#", 1)[0]?.trim();
    const separator = record?.indexOf(":") ?? -1;
    if (!record || separator < 0) continue;
    const key = record.slice(0, separator).trim().toLowerCase();
    const value = record.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!group || hasRules) {
        group = { agents: [], rules: [] };
        groups.push(group);
        hasRules = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      if (!group) continue;
      hasRules = true;
      if (value) group.rules.push({ allow: key === "allow", path: value });
    }
  }
  const specific = groups.filter((item) => item.agents.includes(crawlerAgent));
  const applicable = specific.length
    ? specific
    : groups.filter((item) => item.agents.includes("*"));
  const path = normalizePath(target.pathname + target.search);
  let winner: Rule | undefined;
  for (const item of applicable) {
    for (const rule of item.rules) {
      if (!matches(rule.path, path)) continue;
      if (
        !winner ||
        rule.path.length > winner.path.length ||
        (rule.path.length === winner.path.length && rule.allow)
      ) {
        winner = rule;
      }
    }
  }
  return winner?.allow ?? winner === undefined;
}

export function createCrawlPolicy(args: {
  siteApproved: (origin: string) => Promise<boolean>;
  fetchRobots?: (url: string) => Promise<FetchedResource>;
}): (url: URL) => Promise<void> {
  const robots = new Map<string, Promise<string | null>>();
  const loadRobots =
    args.fetchRobots ??
    ((url: string) =>
      fetchPublic(url, systemResolver, requestOnce, async (next) => {
        if (next.origin !== new URL(url).origin) {
          throw new CrawlPolicyError("robots redirected across origins");
        }
      }));
  return async (url) => {
    parsePublicUrl(url.href);
    if (!(await args.siteApproved(url.origin))) {
      throw new CrawlPolicyError("site terms are not approved");
    }
    let pending = robots.get(url.origin);
    if (!pending) {
      pending = (async () => {
        const response = await loadRobots(`${url.origin}/robots.txt`);
        if (new URL(response.url).origin !== url.origin) {
          throw new CrawlPolicyError("robots redirected across origins");
        }
        if (response.status === 404 || response.status === 410) return null;
        if (response.status !== 200) {
          throw new CrawlPolicyError("robots is unavailable");
        }
        return response.body.toString("utf8");
      })();
      robots.set(url.origin, pending);
    }
    let body: string | null;
    try {
      body = await pending;
    } catch {
      throw new CrawlPolicyError("robots could not be checked");
    }
    if (body !== null && !robotsAllows(body, url)) {
      throw new CrawlPolicyError("robots disallows target");
    }
  };
}
