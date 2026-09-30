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

/** Engineering: an explicit "技術スタック: A, B" line. */
export const techStackParser: DomainFactParser<readonly string[]> = {
  kind: "techStack",
  parse(text) {
    const match = /^技術スタック\s*[:：]\s*(.+)$/u.exec(text);
    if (!match) return [];
    const names = match[1]!.split(/[、,，／/]/u).map((item) => item.trim());
    if (
      names.length === 0 ||
      names.length > 20 ||
      names.some((name) => !/^[A-Za-z][A-Za-z0-9+#. -]{0,39}$/u.test(name))
    )
      return [];
    return [names];
  },
};

export type DomainFacts = { techStack: ParsedFact<readonly string[]> };
