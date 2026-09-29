import type { MatchReport } from "@job-match/contracts";
import { useState } from "react";
import { ShareDialog } from "./ShareDialog";
import "./share.css";

export function ShareButton({ report }: { report: MatchReport }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="primary" type="button" onClick={() => setOpen(true)}>
        共有カードを作る
      </button>
      {open && <ShareDialog report={report} onClose={() => setOpen(false)} />}
    </>
  );
}
