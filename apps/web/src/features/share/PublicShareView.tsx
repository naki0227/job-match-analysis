import type { PublicShare } from "@job-match/contracts";
import { formatDateTime } from "../../lib/format-date";
import { axisNames, axisStatusLabels } from "../result/match-report";
import { ShareCard } from "./ShareCard";
import { toShareCard } from "./share-card";

/** What anyone with the link sees: the stored projection and nothing else. */
export function PublicShareView({ share }: { share: PublicShare }) {
  const { projection } = share;
  return (
    <article
      className="page-head narrow"
      aria-labelledby="public-share-heading"
    >
      <div className="eyebrow">PUBLIC SHARE</div>
      <h1 id="public-share-heading">共有された比較結果</h1>
      <p className="sub">
        ある利用者の希望と、この求人の公開情報を軸ごとに比べた結果です。
      </p>
      <ShareCard card={toShareCard(projection)} label="PUBLIC SHARE" />
      <ul className="public-axes" aria-label="軸ごとの判定">
        {projection.axes.map((axis) => (
          <li key={axis.axisKey}>
            <span>{axisNames[axis.axisKey]}</span>
            <b>{axisStatusLabels[axis.status]}</b>
          </li>
        ))}
      </ul>
      <p className="meta">
        求人の評価日時: {formatDateTime(projection.evaluatedAt)}・共有日時:{" "}
        {formatDateTime(share.sharedAt)}
      </p>
      <p className="notice">
        採否・能力・人柄を判定するものではありません。求人の最新情報は掲載元で確認してください。
      </p>
      <div className="actions">
        <a className="primary share-link" href="/">
          自分の軸で比べてみる
        </a>
      </div>
    </article>
  );
}
