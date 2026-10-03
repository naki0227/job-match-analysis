/**
 * Search queries for one discovery (ADR-047). Built only from the company,
 * the role terms and the employment type: never user, account or profile
 * data. Search operators typed by the user (quotes, site:, -term) are
 * removed so a query cannot be redirected to other sites.
 */
export type DiscoveryQuery = {
  company: string;
  roleQuery?: string | null;
  employmentType?: string | null;
};

const LEGAL_FORMS =
  /株式会社|有限会社|合同会社|（株）|\(株\)|㈱|\binc\.?|\bco\.,?\s*ltd\.?|\bltd\.?|\bcorporation\b|\bcorp\.?/giu;

function clean(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/["“”'`]/g, " ")
    .replace(/\b(?:site|inurl|intitle|filetype):\S*/giu, " ")
    .replace(/(^|\s)[-+]\S*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function searchCompanyName(company: string): string {
  return (
    clean(company.normalize("NFKC").replace(LEGAL_FORMS, " ")) || clean(company)
  );
}

export function buildDiscoveryQueries(
  input: DiscoveryQuery,
  maxQueries: number,
): string[] {
  const company = searchCompanyName(input.company);
  if (!company) return [];
  const role = clean(input.roleQuery ?? "");
  const newGrad = input.employmentType === "new_grad" ? " 新卒" : "";
  const suffix = `${role ? ` ${role}` : ""}${newGrad}`;
  const japaneseCompany = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(
    company,
  );
  const queries = [
    `"${company}" 採用${suffix}`,
    `"${company}" 求人${suffix}`,
    japaneseCompany
      ? `"${company}" 募集要項${suffix}`
      : `"${company}" careers jobs${suffix}`,
  ];
  return [...new Set(queries)].slice(0, maxQueries);
}
