import { useState } from "react";
import { publicShareUrl } from "./share-card";
import { useShareLink } from "./useShareLink";

type Props = { matchResultId: string };

/** Create, copy and revoke the owner's public link to one Match. */
export function PublicLinkSection({ matchResultId }: Props) {
  const { link, create, revoke } = useShareLink(matchResultId);
  const [copied, setCopied] = useState(false);
  const share = link.data ?? null;
  const url = share
    ? publicShareUrl(share.token, window.location.origin)
    : null;
  const failed = link.isError || create.isError || revoke.isError;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="public-link" aria-labelledby="public-link-heading">
      <h4 id="public-link-heading">公開リンク</h4>
      <p className="meta">
        リンクを知っている人は、ログインせずにこのカードの内容（企業名・職種・軸ごとの判定）を見られます。希望値や年収、勤務地は含みません。
      </p>
      {link.isPending && <p role="status">確認中です。</p>}
      {!link.isPending && !share && (
        <button
          className="secondary"
          type="button"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "作成中…" : "公開リンクを作る"}
        </button>
      )}
      {share && url && (
        <>
          <label className="visually-hidden" htmlFor="public-link-url">
            公開リンクのURL
          </label>
          <input
            id="public-link-url"
            className="input"
            type="url"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="share-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => void copy()}
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
            <button
              className="secondary danger"
              type="button"
              disabled={revoke.isPending}
              onClick={() => {
                setCopied(false);
                revoke.mutate(share.shareId);
              }}
            >
              リンクを無効にする
            </button>
          </div>
        </>
      )}
      {failed && (
        <p className="notice danger" role="alert">
          公開リンクを操作できませんでした。時間をおいて再試行してください。
        </p>
      )}
    </section>
  );
}
