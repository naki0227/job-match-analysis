import { describe, expect, it } from "vitest";
import { careerLinks } from "../../src/discovery/career-links.js";
import {
  classifySitemapUrls,
  officialLeads,
} from "../../src/discovery/official-leads.js";
import type { PublicResourceFetcher } from "../../src/discovery/public-resource.js";

const details = (base: string, count: number, suffix = "/") =>
  Array.from({ length: count }, (_, i) => `${base}${100 + i}${suffix}`);

describe("leads from the employer's own sites", () => {
  it("finds posting details as many siblings and their parent as the listing", () => {
    const urls = [
      "https://www.lycorp.example/ja/recruit/career/job-categories/",
      ...details(
        "https://www.lycorp.example/ja/recruit/career/job-categories/ly00",
        9,
      ),
      // Few siblings: categories, not postings.
      "https://www.lycorp.example/ja/recruit/career/business/",
      "https://www.lycorp.example/ja/recruit/career/designer/",
      // Not careers pages at all.
      ...details("https://www.lycorp.example/ja/news/", 20),
    ];
    const { listings, details: found } = classifySitemapUrls(urls, true);
    expect(listings).toEqual([
      "https://www.lycorp.example/ja/recruit/career/job-categories/",
    ]);
    expect(found).toHaveLength(9);
    expect(found.every((url) => url.includes("/job-categories/ly00"))).toBe(
      true,
    );
  });

  it("groups query-string postings and prefers the Japanese locale", () => {
    const urls = [
      ...Array.from(
        { length: 10 },
        (_, i) =>
          `https://www.acn.example/us-en/careers/jobdetails?id=R${i}_en`,
      ),
      ...Array.from(
        { length: 10 },
        (_, i) =>
          `https://www.acn.example/jp-ja/careers/jobdetails?id=R${i}_ja`,
      ),
    ];
    const japanese = classifySitemapUrls(urls, true).details;
    expect(japanese).toHaveLength(10);
    expect(japanese.every((url) => url.includes("/jp-ja/"))).toBe(true);
    expect(classifySitemapUrls(urls, false).details).toHaveLength(20);
  });

  it("puts student pages last unless new grads or interns are asked for", () => {
    const urls = [
      ...details("https://co.example/recruit/newgrads/internship/detail/x", 10),
      ...details("https://co.example/recruit/career/jobs/", 8),
    ];
    expect(classifySitemapUrls(urls, true).details[0]).toContain(
      "/career/jobs/",
    );
    expect(classifySitemapUrls(urls, true, "intern").details[0]).toContain(
      "/internship/",
    );
  });

  it("takes careers pages and ATS links from the homepage, nothing else", () => {
    const html = `
      <a href="/ja/recruit/">採用情報</a>
      <a href="https://recruit.sample.co.jp/">キャリア</a>
      <a href="https://hrmos.co/pages/sample">募集一覧</a>
      <a href="https://hrmos.co/">HRMOS</a>
      <a href="/ja/news/">ニュース</a>
      <a href="https://jobs.other.example/">他社の求人</a>
      <a href="http://www.sample.co.jp/ja/recruit/plain">http</a>`;
    expect(careerLinks(html, "https://www.sample.co.jp/ja/")).toEqual([
      "https://hrmos.co/pages/sample",
      "https://www.sample.co.jp/ja/recruit/",
      "https://recruit.sample.co.jp/",
    ]);
  });

  it("reads sitemaps declared in robots.txt within the fetch budget", async () => {
    const posting = (i: number) =>
      `https://www.sample.co.jp/recruit/career/jobs/${i}/`;
    const resources: Record<string, string> = {
      "https://www.sample.co.jp/robots.txt":
        "User-agent: *\nDisallow: /private/\nSitemap: https://www.sample.co.jp/sitemap.xml\nSitemap: https://elsewhere.example/sitemap.xml",
      "https://www.sample.co.jp/sitemap.xml": `<urlset><url><loc>https://www.sample.co.jp/</loc></url><url><loc>https://www.sample.co.jp/recruit/career/sitemap.xml</loc></url></urlset>`,
      "https://www.sample.co.jp/recruit/career/sitemap.xml": `<urlset>${Array.from(
        { length: 9 },
        (_, i) => `<url><loc>${posting(i)}</loc></url>`,
      ).join("")}</urlset>`,
    };
    const calls: string[] = [];
    const fetchResource: PublicResourceFetcher = async (url) => {
      calls.push(url);
      const body = resources[url];
      if (body === undefined) throw new Error("not found");
      return { url, body };
    };
    const leads = await officialLeads({
      sites: ["https://www.sample.co.jp/"],
      fetchPage: async (url) => ({
        url,
        html: '<a href="https://hrmos.co/pages/sample">採用</a>',
      }),
      fetchResource,
      japanese: true,
      limits: { maxSitemapFetches: 3, maxDetailLeads: 5 },
    });
    expect(leads.slice(0, 6)).toEqual([
      "https://hrmos.co/pages/sample",
      ...[0, 1, 2, 3, 4].map(posting),
    ]);
    // Another origin's sitemap is never read, and the budget is kept.
    expect(calls).not.toContain("https://elsewhere.example/sitemap.xml");
    expect(calls).toHaveLength(3);
  });
});
