import assert from "node:assert/strict";
import test from "node:test";
import {
  axisDisplayNames,
  axisStatusDisplayLabels,
  careerAxisKeys,
  type PublicShare,
  type SharedMatch,
} from "@job-match/contracts";
import { loadOgFont } from "../src/share-page/og-font.js";
import { renderShareHtml } from "../src/share-page/render-html.js";
import { renderShareOgPng } from "../src/share-page/render-og.js";
import { createSharePageRoutes } from "../src/share-page/share-page-routes.js";

const token = "OgShareToken_abcdefghijklmnopqrstuvwxyz0123";
const projection: SharedMatch = {
  companyName: 'サンプル<script>alert("x")</script>株式会社',
  jobTitle: "バックエンドエンジニア",
  evaluatedAt: "2026-09-20T01:02:03+00:00",
  axes: careerAxisKeys.map((axisKey, index) => ({
    axisKey,
    status: (
      [
        "close",
        "different",
        "unknown",
        "conflicting",
        "stale",
        "excluded",
        "close",
        "close",
      ] as const
    )[index]!,
  })),
};
const share: PublicShare = {
  sharedAt: "2026-09-29T01:00:00+00:00",
  projection,
};

function app(read: () => Promise<PublicShare | null>) {
  return createSharePageRoutes(
    () => ({ readPublicShare: read }),
    () => ({
      shareOrigin: "https://share.example",
      appUrl: "https://app.example/",
    }),
  );
}

test("the share page escapes text and carries OG meta for the same projection", () => {
  const html = renderShareHtml(share, {
    page: `https://share.example/s/${token}`,
    image: `https://share.example/s/${token}/og.png`,
    app: "https://app.example/",
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(
    html,
    new RegExp(`og:image" content="https://share.example/s/${token}/og.png"`),
  );
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.match(html, /近い3・相違1・不明3/);
  for (const axis of projection.axes) {
    assert.match(html, new RegExp(axisDisplayNames[axis.axisKey]));
  }
  assert.doesNotMatch(html, /%|％|適合率|preference|importance/);
});

test("malformed, unknown and revoked tokens look the same", async () => {
  const none = app(async () => null);
  const bodies = new Set<string>();
  for (const value of [token, "short", `${"a".repeat(42)}!`]) {
    const response = await none.request(`/s/${encodeURIComponent(value)}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("X-Robots-Tag") ?? "", /noindex/);
    bodies.add(await response.text());
    assert.equal(
      (await none.request(`/s/${encodeURIComponent(value)}/og.png`)).status,
      404,
    );
  }
  assert.equal(bodies.size, 1);
});

test("a live link serves HTML and a PNG; revocation applies on the next request", async () => {
  let live = true;
  const routes = app(async () => (live ? share : null));
  const page = await routes.request(`/s/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("Content-Type") ?? "", /text\/html/);
  const image = await routes.request(`/s/${token}/og.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.equal(image.headers.get("Cache-Control"), "no-store");
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  live = false;
  assert.equal((await routes.request(`/s/${token}`)).status, 404);
  assert.equal((await routes.request(`/s/${token}/og.png`)).status, 404);
});

test("storage failures do not leak details", async () => {
  const failing = app(async () => {
    throw new Error("relation match_shares does not exist");
  });
  const response = await failing.request(`/s/${token}`);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /match_shares/);
});

test("the bundled font draws every label and common company-name kanji", async () => {
  const missing: string[] = [];
  const text = [
    ...Object.values(axisDisplayNames),
    ...Object.values(axisStatusDisplayLabels),
    "株式会社髙橋﨑本ホールディングス・合同会社（ＩＴ）ー〜々",
  ].join("");
  await renderShareOgPng(
    {
      ...projection,
      companyName: text,
      jobTitle: "エンジニア（Go / TypeScript）",
    },
    {
      font: await loadOgFont(),
      onMissingGlyphs: (segment) => missing.push(segment),
    },
  );
  assert.deepEqual(missing, []);
});
