import { Resvg } from "@resvg/resvg-js";
import {
  axisDisplayNames,
  summarizeSharedMatch,
  type SharedMatch,
} from "@job-match/contracts";
import satori from "satori";

type Node = {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
};

const h = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
): Node => ({ type, props: { style, children } });

function stat(value: number, label: string): Node {
  return h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: 220,
      padding: "12px 22px",
      borderRadius: 24,
      border: "2px solid #dce8f1",
      backgroundColor: "#f8fcff",
    },
    [
      h("div", { fontSize: 48, color: "#172235" }, String(value)),
      h("div", { fontSize: 26, color: "#5f7085" }, label),
    ],
  );
}

/** The card layout; its only data input is the public projection. */
export function shareCardTree(projection: SharedMatch): Node {
  const summary = summarizeSharedMatch(projection);
  const axes = summary.closeAxes.map((key) => axisDisplayNames[key]);
  return h(
    "div",
    {
      display: "flex",
      width: 1200,
      height: 630,
      padding: 44,
      backgroundColor: "#f6fbff",
      fontFamily: "Noto Sans JP",
    },
    h(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "40px 48px",
        borderRadius: 34,
        border: "2px solid #dfeaf3",
        backgroundColor: "#ffffff",
      },
      [
        h(
          "div",
          { fontSize: 24, color: "#1f7fb8", letterSpacing: 2 },
          "SHARE RESULT",
        ),
        h("div", { fontSize: 32, color: "#172235", marginTop: 6 }, "job match"),
        h(
          "div",
          {
            display: "block",
            fontSize: 48,
            color: "#172235",
            marginTop: 16,
            lineHeight: 1.25,
            lineClamp: 2,
          },
          projection.companyName,
        ),
        h(
          "div",
          {
            display: "block",
            fontSize: 28,
            color: "#5f7085",
            marginTop: 12,
            lineClamp: 1,
          },
          projection.jobTitle,
        ),
        h("div", { display: "flex", gap: 22, marginTop: 20 }, [
          stat(summary.close, "近い"),
          stat(summary.different, "相違"),
          ...(summary.partial > 0 ? [stat(summary.partial, "一部近い")] : []),
          stat(summary.unknown, "不明"),
        ]),
        h(
          "div",
          { fontSize: 24, color: "#4d647b", marginTop: 16 },
          axes.length > 0 ? `近い軸：${axes.join(" / ")}` : " ",
        ),
        h(
          "div",
          { fontSize: 20, color: "#5f7085", marginTop: "auto" },
          "希望値・年収・勤務地は含みません。採否や能力の判定ではありません。",
        ),
      ],
    ),
  );
}

export type OgRenderOptions = {
  font: Buffer;
  /** Called for text the bundled subset cannot draw (for tests/metrics). */
  onMissingGlyphs?: (text: string) => void;
};

export async function renderShareOgPng(
  projection: SharedMatch,
  options: OgRenderOptions,
): Promise<Buffer> {
  const svg = await satori(
    shareCardTree(projection) as unknown as Parameters<typeof satori>[0],
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Noto Sans JP",
          data: options.font,
          weight: 700,
          style: "normal",
        },
      ],
      loadAdditionalAsset: async (_code: string, segment: string) => {
        options.onMissingGlyphs?.(segment);
        return [];
      },
    },
  );
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}
