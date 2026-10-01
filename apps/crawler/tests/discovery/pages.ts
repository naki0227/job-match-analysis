/** Synthetic pages for discovery tests; no network. */
export function jobPage(posting: {
  title: string;
  org: string;
  orgUrl?: string;
  employmentType?: string;
  region?: string;
  validThrough?: string;
  body?: string;
}): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: posting.title,
    hiringOrganization: {
      "@type": "Organization",
      name: posting.org,
      ...(posting.orgUrl ? { sameAs: posting.orgUrl } : {}),
    },
    ...(posting.employmentType
      ? { employmentType: posting.employmentType }
      : {}),
    ...(posting.region
      ? { jobLocation: { address: { addressRegion: posting.region } } }
      : {}),
    ...(posting.validThrough ? { validThrough: posting.validThrough } : {}),
  };
  return `<html><head><title>${posting.title}</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><main><h1>${posting.title}</h1><p>${posting.body ?? "業務内容の説明です。"}</p></main></body></html>`;
}

export function listingPage(links: string[]): string {
  return `<html><body><main><h1>募集職種</h1><ul>${links
    .map((href, index) => `<li><a href="${href}">職種${index + 1}</a></li>`)
    .join("")}</ul></main></body></html>`;
}
