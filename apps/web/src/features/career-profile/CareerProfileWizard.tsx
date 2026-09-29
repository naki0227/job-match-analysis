import { careerAxisKeys } from "@job-match/contracts";
import { useState } from "react";
import { AxisStep } from "./AxisStep";
import { CareerProfileApiError } from "./career-profile-api";
import { ConstraintsStep } from "./ConstraintsStep";
import {
  draftFromProfile,
  draftToPayload,
  emptyDraft,
  type DraftIssue,
  type ProfileDraft,
} from "./profile-draft";
import { RoleStep } from "./RoleStep";
import { useCareerProfile, useSaveCareerProfile } from "./useCareerProfile";
import "./career-profile.css";

type Props = { onSaved: (version: number) => void };

const totalSteps = careerAxisKeys.length + 2;

const issueMessages: Record<DraftIssue, string> = {
  roles: "希望職種を1つ以上選んでください。",
  axes: "8つの軸すべてで重視度を選んでください。",
  salary: "最低年収は1以上の整数（円）で入力してください。",
};

function saveErrorMessage(error: unknown): string {
  if (error instanceof CareerProfileApiError && error.kind === "conflict") {
    return "他の画面で希望条件が更新されました。再読み込みしてから入力してください。";
  }
  if (error instanceof CareerProfileApiError && error.kind === "unauthorized") {
    return "ログインが必要です。再読み込みしてログインしてください。";
  }
  return "保存できませんでした。同じ内容で再試行できます。";
}

function WizardBody({
  initial,
  expectedVersion,
  onSaved,
}: {
  initial: ProfileDraft;
  expectedVersion: number;
  onSaved: (version: number) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const save = useSaveCareerProfile();
  const axisKey = careerAxisKeys[step - 1];
  const last = step === totalSteps - 1;
  const canAdvance =
    step === 0
      ? draft.targetRoles.length > 0
      : axisKey
        ? draft.axes[axisKey].importance !== null
        : true;

  function submit() {
    const result = draftToPayload(draft);
    if (!result.ok) {
      setMessage(issueMessages[result.issue]);
      return;
    }
    setMessage("");
    save.mutate(
      { expectedVersion, profile: result.payload },
      {
        onSuccess: (saved) => onSaved(saved.profileVersion),
        onError: (error) => setMessage(saveErrorMessage(error)),
      },
    );
  }

  return (
    <section className="career-profile" aria-label="希望条件の入力">
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${((step + 1) / totalSteps) * 100}%` }} />
      </div>
      <p className="meta">
        ステップ {step + 1} / {totalSteps}・現在の確定版:{" "}
        {expectedVersion === 0 ? "未保存" : `第${expectedVersion}版`}
      </p>
      {step === 0 && (
        <RoleStep
          roles={draft.targetRoles}
          onChange={(targetRoles) => setDraft({ ...draft, targetRoles })}
        />
      )}
      {axisKey && (
        <AxisStep
          key={axisKey}
          axisKey={axisKey}
          index={step - 1}
          total={careerAxisKeys.length}
          answer={draft.axes[axisKey]}
          onChange={(answer) =>
            setDraft({ ...draft, axes: { ...draft.axes, [axisKey]: answer } })
          }
        />
      )}
      {last && <ConstraintsStep draft={draft} onChange={setDraft} />}
      <div className="actions wizard-actions">
        <button
          className="secondary"
          type="button"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          戻る
        </button>
        {last ? (
          <button
            className="primary"
            type="button"
            disabled={save.isPending}
            onClick={submit}
          >
            {save.isPending ? "保存中…" : "保存する"}
          </button>
        ) : (
          <button
            className="primary"
            type="button"
            disabled={!canAdvance}
            onClick={() => setStep(step + 1)}
          >
            次へ
          </button>
        )}
      </div>
      {message && (
        <p className="notice danger" role="alert">
          {message}
        </p>
      )}
      <p className="field-hint wizard-note">
        希望と重視度は別々に入力します。結果は採否や能力の判定ではありません。
      </p>
    </section>
  );
}

/** Career profile as one question per step, loaded and saved via the API. */
export function CareerProfileWizard({ onSaved }: Props) {
  const profile = useCareerProfile();
  if (profile.isPending) return <p role="status">希望条件を読み込み中です。</p>;
  if (profile.isError) {
    return (
      <div className="notice danger" role="alert">
        <p>保存済みの希望条件を読み込めませんでした。</p>
        <div className="actions">
          <button
            className="secondary"
            type="button"
            onClick={() => void profile.refetch()}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }
  const saved = profile.data;
  return (
    <WizardBody
      key={saved?.profileVersion ?? 0}
      initial={saved ? draftFromProfile(saved.profile) : emptyDraft()}
      expectedVersion={saved?.profileVersion ?? 0}
      onSaved={onSaved}
    />
  );
}
