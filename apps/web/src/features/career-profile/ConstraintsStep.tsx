import { prefectures } from "./assessment-catalog";
import type { ProfileDraft } from "./profile-draft";

type Props = {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
};

/** Hard constraints are checked one by one and never offset by axes. */
export function ConstraintsStep({ draft, onChange }: Props) {
  function toggleLocation(code: string, checked: boolean) {
    onChange({
      ...draft,
      locations: checked
        ? [...draft.locations, code]
        : draft.locations.filter((location) => location !== code),
    });
  }

  return (
    <div className="wizard-step">
      <div className="eyebrow">MUST HAVE</div>
      <h1 className="question">譲れない条件は？</h1>
      <p className="sub">
        指定した条件は、軸が近くても満たさなければ「満たさない」と表示します。
      </p>
      <div className="form-field">
        <label htmlFor="min-salary">最低年収（円、額面）</label>
        <input
          id="min-salary"
          className="input"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={draft.minSalary}
          onChange={(event) =>
            onChange({ ...draft, minSalary: event.target.value })
          }
        />
        <p className="field-hint">指定しない場合は空欄のままにしてください。</p>
      </div>
      <details className="locations">
        <summary>
          許容する勤務地（{draft.locations.length}都道府県を選択）
        </summary>
        <div className="prefecture-grid">
          {prefectures.map(([code, name]) => (
            <label key={code}>
              <input
                type="checkbox"
                checked={draft.locations.includes(code)}
                onChange={(event) => toggleLocation(code, event.target.checked)}
              />
              {name}
            </label>
          ))}
        </div>
      </details>
      <label className="remote-option">
        <input
          type="checkbox"
          checked={draft.fullRemoteRequired}
          onChange={(event) =>
            onChange({ ...draft, fullRemoteRequired: event.target.checked })
          }
        />
        フルリモートを必須にする
      </label>
    </div>
  );
}
