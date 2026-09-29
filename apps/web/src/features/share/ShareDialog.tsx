import type { MatchReport } from "@job-match/contracts";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { PendingFeature } from "../../components/PendingFeature";
import { ShareCard } from "./ShareCard";
import { drawShareCard, toShareCard, xIntentUrl } from "./share-card";

type Props = {
  report: MatchReport;
  onClose: () => void;
};

function saveImage(report: MatchReport): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) return false;
  drawShareCard(context, toShareCard(report));
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = "job-match-share.png";
  link.click();
  return true;
}

export function ShareDialog({ report, onClose }: Props) {
  const card = toShareCard(report);
  const [message, setMessage] = useState("");

  return (
    <Dialog title="共有カード" onClose={onClose}>
      <ShareCard card={card} label="SHARE RESULT" />
      <div className="share-actions">
        <a
          className="primary share-link"
          href={xIntentUrl(card)}
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
              saveImage(report)
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
      <PendingFeature
        title="公開ページ"
        reason="URLで見られる公開ページは準備中です（Issue #39）。"
      />
    </Dialog>
  );
}
