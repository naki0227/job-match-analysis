import {
  axisDisplayNames,
  axisStatusDisplayLabels,
  summarizeSharedMatch,
  type PublicShare,
} from "@job-match/contracts";

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => escapes[char] ?? char);
}

const formatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const styles = `
:root{color-scheme:light;--ink:#172235;--muted:#5f7085;--line:#dce8f1;--blue:#1f7fb8;--soft:#f5f9fc}
*{box-sizing:border-box}body{margin:0;background:#fbfdff;color:var(--ink);font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;line-height:1.6}
main{max-width:720px;margin:0 auto;padding:32px 16px 56px}.eyebrow{color:var(--blue);font-size:11px;font-weight:900;letter-spacing:.11em}
h1{font-size:28px;margin:6px 0 4px}.sub{color:var(--muted);font-size:14px}.card{margin-top:20px;padding:20px;border:1px solid var(--line);border-radius:22px;background:#fff}
.company{font-size:22px;font-weight:800;margin:0}.stats{display:flex;gap:10px;margin-top:14px}.stat{flex:1;padding:10px;border:1px solid var(--line);border-radius:14px}
.stat b{display:block;font-size:22px}.stat span{color:var(--muted);font-size:12px}ul{list-style:none;padding:0;margin:18px 0;border-top:1px solid var(--line)}
li{display:flex;justify-content:space-between;padding:10px 2px;border-bottom:1px solid var(--line);font-size:14px}.note{padding:12px;border-radius:12px;background:var(--soft);color:var(--muted);font-size:13px}
a.cta{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:14px;background:var(--blue);color:#fff;font-weight:800;text-decoration:none}`;

function page(head: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">${head}<style>${styles}</style></head><body><main>${body}</main></body></html>`;
}

export type ShareUrls = {
  /** Absolute URL of this page. */
  page: string;
  /** Absolute URL of the OG image for this page. */
  image: string;
  /** Where visitors can start using the app. */
  app: string;
};

/**
 * Server-rendered share page. Its only input is the stored public projection
 * (plus the share time), exactly like the OG image.
 */
export function renderShareHtml(share: PublicShare, urls: ShareUrls): string {
  const { projection } = share;
  const summary = summarizeSharedMatch(projection);
  const title = `${projection.companyName}（${projection.jobTitle}）を自分の軸で比べた結果`;
  const partial = summary.partial > 0 ? `・一部近い${summary.partial}` : "";
  const description = `近い${summary.close}・相違${summary.different}${partial}・不明${summary.unknown}。採否や能力の判定ではなく、公開情報との比較です。`;
  const meta = [
    `<title>${escapeHtml(title)} | job match</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="job match">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(urls.page)}">`,
    `<meta property="og:image" content="${escapeHtml(urls.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("");
  const axes = projection.axes
    .map(
      (axis) =>
        `<li><span>${escapeHtml(axisDisplayNames[axis.axisKey])}</span><b>${escapeHtml(axisStatusDisplayLabels[axis.status])}</b></li>`,
    )
    .join("");
  const body = `<div class="eyebrow">PUBLIC SHARE</div><h1>共有された比較結果</h1>
<p class="sub">ある利用者の希望と、この求人の公開情報を軸ごとに比べた結果です。</p>
<section class="card" aria-label="共有カード"><p class="company">${escapeHtml(projection.companyName)}</p><p class="sub">${escapeHtml(projection.jobTitle)}</p>
<div class="stats"><div class="stat"><b>${summary.close}</b><span>近い</span></div><div class="stat"><b>${summary.different}</b><span>相違</span></div>${summary.partial > 0 ? `<div class="stat"><b>${summary.partial}</b><span>一部近い</span></div>` : ""}<div class="stat"><b>${summary.unknown}</b><span>不明</span></div></div></section>
<ul aria-label="軸ごとの判定">${axes}</ul>
<p class="sub">求人の評価日: ${escapeHtml(formatter.format(new Date(projection.evaluatedAt)))}・共有日: ${escapeHtml(formatter.format(new Date(share.sharedAt)))}</p>
<p class="note">採否・能力・人柄を判定するものではありません。求人の最新情報は掲載元で確認してください。</p>
<a class="cta" href="${escapeHtml(urls.app)}">自分の軸で比べてみる</a>`;
  return page(meta, body);
}

/** Same page for malformed, unknown and revoked links: nothing to compare. */
export function renderUnavailableHtml(appUrl: string): string {
  return page(
    `<title>共有結果を表示できません | job match</title>`,
    `<div class="eyebrow">PUBLIC SHARE</div><h1>共有結果を表示できません</h1><p class="sub">このリンクは無効か、共有が停止されました。</p><a class="cta" href="${escapeHtml(appUrl)}">job matchを開く</a>`,
  );
}
