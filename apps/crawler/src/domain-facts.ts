import type { ParsedFact } from "./deterministic-parser.js";

/**
 * Occupation-specific facts. Generic job facts (salary, location, schedule,
 * employment type, role) apply to every posting; these apply only when a
 * posting states them. Engineering tech stacks are the first entry; sales
 * (products, customer segment), HR or marketing parsers can be added here
 * without touching the generic parser.
 */
export type DomainFactParser<T> = {
  kind: string;
  parse: (text: string) => readonly T[];
};

const LABELED_STACK = /^技術スタック\s*[:：]\s*(.+)$/u;

const TECH_MENTIONS: readonly {
  name: string;
  pattern: RegExp;
}[] = [
  {
    // "Go" is ordinary English, so require an engineering context.
    name: "Go",
    pattern:
      /\bGolang\b|\bGo-based\b|\bGo\s+(?:developer|development|applications?|services?|microservices?|code|language)\b|\b(?:developer|engineer)\b[^\n()]{0,32}\(\s*Go\s*\)|\b(?:using|written in|developed in|developing in)\s+Go\b/iu,
  },
  { name: "TypeScript", pattern: /\bTypeScript\b/u },
  { name: "JavaScript", pattern: /\bJavaScript\b/u },
  { name: "Java", pattern: /\bJava\b/u },
  { name: "Kotlin", pattern: /\bKotlin\b/u },
  { name: "Rust", pattern: /\bRust\b/u },
  { name: "Python", pattern: /\bPython\b/u },
  { name: "Ruby", pattern: /\bRuby\b/u },
  { name: "Ruby on Rails", pattern: /\bRuby on Rails\b|\bRails\b/u },
  { name: "React", pattern: /\bReact\b/u },
  { name: "Next.js", pattern: /\bNext\.js\b/u },
  { name: "Node.js", pattern: /\bNode\.js\b/u },
  { name: "PostgreSQL", pattern: /\bPostgreSQL\b|\bPostgres\b/u },
  { name: "MySQL", pattern: /\bMySQL\b/u },
  { name: "Redis", pattern: /\bRedis\b/u },
  { name: "Kafka", pattern: /\bKafka\b/u },
  { name: "gRPC", pattern: /\bgRPC\b/u },
  { name: "Docker", pattern: /\bDocker\b/u },
  { name: "Kubernetes", pattern: /\bKubernetes\b|\bK8s\b/u },
  { name: "Terraform", pattern: /\bTerraform\b/u },
  { name: "AWS", pattern: /\bAWS\b|\bAmazon Web Services\b/u },
  { name: "GCP", pattern: /\bGCP\b|\bGoogle Cloud(?: Platform)?\b/u },
  { name: "Azure", pattern: /\bAzure\b/u },
];

function labeledStack(text: string): string[] {
  const match = LABELED_STACK.exec(text);
  if (!match) return [];
  const names = match[1]!
    .split(/[、,，／/]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    names.length === 0 ||
    names.length > 20 ||
    names.some((name) => !/^[A-Za-z][A-Za-z0-9+#. -]{0,39}$/u.test(name))
  )
    return [];
  return names;
}

function mentionedTechnologies(text: string): string[] {
  return TECH_MENTIONS.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );
}

/**
 * Engineering technologies explicitly written in the posting. A labelled
 * stack still accepts arbitrary safe names; elsewhere only unambiguous
 * technology mentions are recognized. In particular, bare English "go" is
 * never treated as the Go language.
 */
export const techStackParser: DomainFactParser<readonly string[]> = {
  kind: "techStack",
  parse(text) {
    const labeled = labeledStack(text);
    if (labeled.length) return [labeled];
    const mentioned = mentionedTechnologies(text);
    return mentioned.length ? [mentioned] : [];
  },
};

export type DomainFacts = { techStack: ParsedFact<readonly string[]> };
