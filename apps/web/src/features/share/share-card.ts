import type { MatchReport } from "@job-match/contracts";
import { axisNames, orderAxes, summarizeTarget } from "../result/match-report";

/**
 * What a share card may contain. Preference values, salary, locations and
 * account details are deliberately absent.
 */
export type ShareCardData = {
  companyName: string;
  jobTitle: string;
  close: number;
  different: number;
  unknown: number;
  closeAxes: string[];
};

export function toShareCard(report: MatchReport): ShareCardData {
  const summary = summarizeTarget(report.job);
  const closeAxes =
    report.job.status === "comparable"
      ? orderAxes(report.job.axes)
          .filter((axis) => axis.status === "close")
          .slice(0, 3)
          .map((axis) => axisNames[axis.axisKey])
      : [];
  return {
    companyName: report.companyName,
    jobTitle: report.jobTitle,
    close: summary?.close ?? 0,
    different: summary?.different ?? 0,
    unknown: summary?.unknown ?? 0,
    closeAxes,
  };
}

export function shareText(card: ShareCardData): string {
  return `${card.companyName}（${card.jobTitle}）を自分の軸で比べてみた：近い${card.close}・相違${card.different}・不明${card.unknown} #jobmatch`;
}

export function xIntentUrl(card: ShareCardData): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(shareText(card))}`;
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
  ctx.fillText("個人情報を含めず、比較結果だけを共有しています", 84, 556);
}
