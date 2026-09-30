import { toSharedMatch, type MatchReport } from "@job-match/contracts";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { PublicLinkSection } from "./PublicLinkSection";
import { ShareCard } from "./ShareCard";
import {
  drawShareCard,
  publicShareUrl,
  toShareCard,
  xIntentUrl,
  type ShareCardData,
} from "./share-card";
import { useShareLink } from "./useShareLink";

type Props = {
  report: MatchReport;
  onClose: () => void;
};

function saveImage(card: ShareCardData): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) return false;
  drawShareCard(context, card);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = "job-match-share.png";
  link.click();
  return true;
}

export function ShareDialog({ report, onClose }: Props) {
  const card = toShareCard(toSharedMatch(report));
  const { link } = useShareLink(report.matchResultId);
  const url = link.data
    ? publicShareUrl(link.data.token, window.location.origin)
    : undefined;
  const [message, setMessage] = useState("");

  return (
    <Dialog title="共有カード" onClose={onClose}>
      <ShareCard card={card} label="SHARE RESULT" />
      <div className="share-actions">
        <a
          className="primary share-link"
          href={xIntentUrl(card, url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Xで共有
        </a>
        <button
          className="secondary"
          type="button"
          onClick={() =>
            setMessage(
              saveImage(card)
                ? "共有画像を保存しました。"
                : "この環境では画像を作れませんでした。",
            )
          }
        >
          画像を保存
        </button>
      </div>
      {message && (
        <p className="meta" role="status">
          {message}
        </p>
      )}
      <PublicLinkSection matchResultId={report.matchResultId} />
    </Dialog>
  );
}
