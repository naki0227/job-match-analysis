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

function employmentQueries(
  company: string,
  role: string,
  employmentType: string | null | undefined,
): string[] | null {
  const roleSuffix = role ? ` ${role}` : "";
  switch (employmentType) {
    case "new_grad":
      return [
        `"${company}" 新卒採用${roleSuffix}`,
        `"${company}" 新卒 募集要項${roleSuffix}`,
        `"${company}" new graduate careers${roleSuffix}`,
      ];
    case "intern":
      return [
        `"${company}" インターン 採用${roleSuffix}`,
        `"${company}" インターン 募集要項${roleSuffix}`,
        `"${company}" internship careers${roleSuffix}`,
      ];
    case "full_time":
      return [
        `"${company}" 中途採用${roleSuffix}`,
        `"${company}" キャリア採用${roleSuffix}`,
        `"${company}" careers jobs${roleSuffix}`,
      ];
    case "contract":
      return [
        `"${company}" 契約社員 採用${roleSuffix}`,
        `"${company}" 契約 募集要項${roleSuffix}`,
        `"${company}" contract jobs${roleSuffix}`,
      ];
    case "part_time":
      return [
        `"${company}" アルバイト 採用${roleSuffix}`,
        `"${company}" パート 求人${roleSuffix}`,
        `"${company}" part time jobs${roleSuffix}`,
      ];
    default:
      return null;
  }
}

export function buildDiscoveryQueries(
  input: DiscoveryQuery,
  maxQueries: number,
): string[] {
  const company = searchCompanyName(input.company);
  if (!company) return [];
  const role = clean(input.roleQuery ?? "");
  const targeted = employmentQueries(company, role, input.employmentType);
  if (targeted) return [...new Set(targeted)].slice(0, maxQueries);

  const suffix = role ? ` ${role}` : "";
  const japaneseCompany =
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(company);
  const queries = [
    `"${company}" 採用${suffix}`,
    `"${company}" 求人${suffix}`,
    japaneseCompany
      ? `"${company}" 募集要項${suffix}`
      : `"${company}" careers jobs${suffix}`,
  ];
  return [...new Set(queries)].slice(0, maxQueries);
}
