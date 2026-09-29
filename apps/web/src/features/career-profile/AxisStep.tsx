import { useId } from "react";
import { axisQuestions } from "./assessment-catalog";
import {
  importanceLevels,
  type AxisDraft,
  type AxisKey,
} from "./profile-draft";

type Props = {
  axisKey: AxisKey;
  index: number;
  total: number;
  answer: AxisDraft;
  onChange: (answer: AxisDraft) => void;
};

/** One axis per screen: preference slider and a separate importance choice. */
export function AxisStep({ axisKey, index, total, answer, onChange }: Props) {
  const question = axisQuestions[axisKey];
  const sliderId = useId();
  const importanceName = useId();
  const standard = importanceLevels.some(
    (level) => level.value === answer.importance,
  );

  return (
    <div className="wizard-step">
      <div className="eyebrow">CAREER PROFILE</div>
      <p className="question-count">
        {index + 1} / {total}
      </p>
      <h1 className="question">{question.label}</h1>
      <div className="slider-wrap">
        <label className="visually-hidden" htmlFor={sliderId}>
          希望値
        </label>
        <input
          id={sliderId}
          className="slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={answer.preference}
          aria-valuetext={`${answer.preference}`}
          onChange={(event) =>
            onChange({ ...answer, preference: Number(event.target.value) })
          }
        />
        <div className="ends" aria-hidden="true">
          <span>{question.anchors[0]}</span>
          <span>{question.anchors[1]}</span>
          <span>{question.anchors[2]}</span>
        </div>
        <p className="value" aria-hidden="true">
          {answer.preference}
        </p>
      </div>
      <fieldset className="importance-group">
        <legend>どれくらい重視する？</legend>
        <div className="importance">
          {importanceLevels.map((level) => (
            <label key={level.value} className="imp">
              <input
                type="radio"
                name={importanceName}
                value={level.value}
                checked={answer.importance === level.value}
                onChange={() =>
                  onChange({ ...answer, importance: level.value })
                }
              />
              <span>{level.label}</span>
            </label>
          ))}
        </div>
        {answer.importance !== null && !standard && (
          <p className="field-hint">
            保存済みの重要度: {answer.importance}（選び直すと更新されます）
          </p>
        )}
        <p className="field-hint">
          「比較しない」を選ぶと、この軸は結果の比較から除きます。
        </p>
      </fieldset>
    </div>
  );
}
