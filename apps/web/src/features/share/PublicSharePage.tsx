import { useQuery } from "@tanstack/react-query";
import { Mascot } from "../../components/Mascot";
import { ShareApiError, readPublicShare } from "./share-api";
import { PublicShareView } from "./PublicShareView";
import "./share.css";

/** Route /s/:token. Needs no login and reads nothing private. */
export function PublicSharePage({ token }: { token: string }) {
  const share = useQuery({
    queryKey: ["public-share", token],
    queryFn: ({ signal }) => readPublicShare(token, fetch, signal),
  });

  return (
    <div className="app">
      <main className="shell">
        {share.isPending && <p role="status">読み込み中です。</p>}
        {share.isError && (
          <section className="page-head narrow empty">
            <Mascot pose="sorry" size="small" />
            <h1>共有結果を表示できません</h1>
            <p className="sub">
              {share.error instanceof ShareApiError &&
              share.error.kind === "not_found"
                ? "このリンクは無効か、共有が停止されました。"
                : "時間をおいて再度お試しください。"}
            </p>
            <div className="actions centered">
              <a className="primary share-link" href="/">
                job matchを開く
              </a>
            </div>
          </section>
        )}
        {share.data && <PublicShareView share={share.data} />}
      </main>
    </div>
  );
}
