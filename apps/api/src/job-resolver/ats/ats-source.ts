import type { CandidateSource } from "@job-match/application";
import type { JobCandidate } from "@job-match/domain";
import type { AtsAdapter } from "./adapters.js";
import type { ListingFetch } from "./public-listing.js";

/**
 * Finds the company's ATS from postings already analyzed here, then reads
 * that ATS's public listing for all of the company's open postings.
 */
export function createAtsSource(
  adapters: readonly AtsAdapter[],
  known: (company: string) => Promise<readonly JobCandidate[]>,
  fetchListing: ListingFetch,
): CandidateSource {
  return {
    name: "ats",
    async discover(query) {
      const listings = new Map<
        string,
        { adapter: AtsAdapter; slug: string; companyName: string }
      >();
      for (const posting of await known(query.company)) {
        const url = new URL(posting.url);
        for (const adapter of adapters) {
          const slug = adapter.slugFromUrl(url);
          if (slug) {
            listings.set(`${adapter.name}:${slug}`, {
              adapter,
              slug,
              companyName: posting.companyName,
            });
          }
        }
      }
      const found: JobCandidate[] = [];
      for (const { adapter, slug, companyName } of [...listings.values()].slice(
        0,
        3,
      )) {
        const html = await fetchListing(adapter.listingUrl(slug));
        if (html) found.push(...adapter.parseListing(html, slug, companyName));
      }
      return found;
    },
  };
}
