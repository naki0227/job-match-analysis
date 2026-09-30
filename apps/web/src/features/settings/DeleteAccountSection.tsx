import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { useAccessToken } from "../auth/access-token-context";
import { deleteAccount } from "./account-api";

const phrase = "退会する";

type Props = { onDeleted: () => void };

/** Irreversible account deletion behind a typed confirmation. */
export function DeleteAccountSection({ onDeleted }: Props) {
  const getAccessToken = useAccessToken();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await deleteAccount(await getAccessToken());
      onDeleted();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section className="danger-zone" aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading">退会</h2>
      <p className="meta">
        アカウントと、あなたに結びつくデータをすべて削除します。元に戻せません。
      </p>
      <button
        className="secondary danger"
        type="button"
        onClick={() => setOpen(true)}
      >
        退会の手続きへ
      </button>
      {open && (
        <Dialog
          title="本当に退会しますか？"
          onClose={() => {
            if (busy) return;
            setOpen(false);
            setTyped("");
          }}
        >
          <p>この操作は取り消せません。次のデータがすぐに削除されます。</p>
          <ul className="delete-list">
            <li>ログイン情報とプロフィール（学歴を含む）</li>
            <li>希望条件のすべての版（8軸・重視度・必須条件）</li>
            <li>比較結果と分析履歴</li>
            <li>公開リンク（共有先でも見られなくなります）</li>
            <li>利用規約などの確認履歴</li>
          </ul>
          <p className="meta">
            企業・求人の公開情報から作った共有の評価は、ほかの利用者も使うため残ります。個人を特定できない集計値だけが残ることがあります。
          </p>
          <label htmlFor="delete-confirmation">
            確認のため「{phrase}」と入力してください
          </label>
          <input
            id="delete-confirmation"
            className="input"
            type="text"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="actions">
            <button
              className="primary danger-fill"
              type="button"
              disabled={typed !== phrase || busy}
              onClick={() => void confirm()}
            >
              {busy ? "削除しています…" : "完全に削除する"}
            </button>
          </div>
          {failed && (
            <p className="notice danger" role="alert">
              退会できませんでした。時間をおいて再試行してください。データは削除されていません。
            </p>
          )}
        </Dialog>
      )}
    </section>
  );
}
