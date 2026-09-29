import { axisQuestions } from "./assessment-catalog";

export type AxisDraft = {
  preference: number | null;
  importance: number | null;
};
type AxisKey = keyof typeof axisQuestions;

type Props = {
  axisKey: AxisKey;
  answer: AxisDraft;
  onChange: (answer: AxisDraft) => void;
};

export function AxisQuestion({ axisKey, answer, onChange }: Props) {
  const question = axisQuestions[axisKey];
  const answered = answer.preference !== null && answer.importance !== null;
  const preferenceId = `${axisKey}-preference`;
  const importanceId = `${axisKey}-importance`;

  return (
    <fieldset className="axis-question">
      <legend>{question.label}</legend>
      {!answered ? (
        <button
          type="button"
          onClick={() => onChange({ preference: 50, importance: 50 })}
        >
          回答する
        </button>
      ) : (
        <>
          <label htmlFor={preferenceId}>希望値: {answer.preference}</label>
          <input
            id={preferenceId}
            type="range"
            min="0"
            max="100"
            step="1"
            value={answer.preference ?? 50}
            onChange={(event) =>
              onChange({ ...answer, preference: Number(event.target.value) })
            }
          />
          <div className="axis-anchors" aria-label="希望値の目安">
            <span>0: {question.anchors[0]}</span>
            <span>50: {question.anchors[1]}</span>
            <span>100: {question.anchors[2]}</span>
          </div>
          <label htmlFor={importanceId}>重要度: {answer.importance}</label>
          <input
            id={importanceId}
            type="range"
            min="0"
            max="100"
            step="1"
            value={answer.importance ?? 50}
            onChange={(event) =>
              onChange({ ...answer, importance: Number(event.target.value) })
            }
          />
          <p className="field-hint">
            重要度0は比較から除外し、希望値は保存します。
          </p>
          <button
            type="button"
            onClick={() => onChange({ preference: null, importance: null })}
          >
            未回答に戻す
          </button>
        </>
      )}
    </fieldset>
  );
}
