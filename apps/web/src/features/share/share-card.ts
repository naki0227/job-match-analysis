import { summarizeSharedMatch, type SharedMatch } from "@job-match/contracts";
import { axisNames } from "../result/match-report";

/**
 * Card fields derived from the public projection only, so the on-screen card,
 * the saved image and the public page cannot show different data.
 */
export type ShareCardData = {
  companyName: string;
  jobTitle: string;
  close: number;
  different: number;
  unknown: number;
  closeAxes: string[];
};

export function toShareCard(projection: SharedMatch): ShareCardData {
  const summary = summarizeSharedMatch(projection);
  return {
    companyName: projection.companyName,
    jobTitle: projection.jobTitle,
    close: summary.close,
    different: summary.different,
    unknown: summary.unknown,
    closeAxes: summary.closeAxes.map((axisKey) => axisNames[axisKey]),
  };
}

export function shareText(card: ShareCardData): string {
  return `${card.companyName}（${card.jobTitle}）を自分の軸で比べてみた：近い${card.close}・相違${card.different}・不明${card.unknown} #jobmatch`;
}

export function xIntentUrl(card: ShareCardData, link?: string): string {
  const params = new URLSearchParams({ text: shareText(card) });
  if (link) params.set("url", link);
  return `https://x.com/intent/post?${params.toString()}`;
}

/**
 * Public page URL for a share token. The page and its OG image are rendered
 * by the API at /s/<token>; VITE_PUBLIC_SHARE_ORIGIN points at the origin
 * that serves that path when it differs from the SPA's own origin.
 */
export function publicShareUrl(
  token: string,
  origin: string = import.meta.env.VITE_PUBLIC_SHARE_ORIGIN ||
    window.location.origin,
): string {
  return `${origin.replace(/\/$/, "")}/s/${token}`;
}

/** The subset of the 2D canvas API the card drawing needs. */
export type CardCanvas = Pick<
  CanvasRenderingContext2D,
  "fillStyle" | "font" | "fillRect" | "fillText"
>;

export function drawShareCard(ctx: CardCanvas, card: ShareCardData): void {
  ctx.fillStyle = "#f6fbff";
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(48, 42, 1104, 546);
  ctx.fillStyle = "#1f7fb8";
  ctx.font = '800 22px "Zen Maru Gothic", sans-serif';
  ctx.fillText("SHARE RESULT", 84, 104);
  ctx.fillStyle = "#172235";
  ctx.font = '700 32px "Zen Maru Gothic", sans-serif';
  ctx.fillText("job match", 84, 156);
  ctx.font = '700 54px "Zen Maru Gothic", sans-serif';
  ctx.fillText(card.companyName, 84, 240, 1030);
  ctx.fillStyle = "#5f7085";
  ctx.font = '500 30px "Zen Kaku Gothic New", sans-serif';
  ctx.fillText(card.jobTitle, 84, 288, 1030);
  const stats: Array<[number, string]> = [
    [card.close, "近い"],
    [card.different, "相違"],
    [card.unknown, "不明"],
  ];
  stats.forEach(([value, label], index) => {
    const x = 84 + index * 220;
    ctx.fillStyle = "#172235";
    ctx.font = '700 48px "Zen Maru Gothic", sans-serif';
    ctx.fillText(String(value), x, 392);
    ctx.fillStyle = "#5f7085";
    ctx.font = '500 26px "Zen Kaku Gothic New", sans-serif';
    ctx.fillText(label, x, 430);
  });
  if (card.closeAxes.length > 0) {
    ctx.fillStyle = "#4d647b";
    ctx.font = '500 26px "Zen Kaku Gothic New", sans-serif';
    ctx.fillText(`近い軸：${card.closeAxes.join(" / ")}`, 84, 500, 1030);
  }
  ctx.fillStyle = "#5f7085";
  ctx.font = '500 20px "Zen Kaku Gothic New", sans-serif';
  ctx.fillText(
    "本名・メール・希望年収・希望勤務地・希望値は含みません",
    84,
    556,
  );
}
