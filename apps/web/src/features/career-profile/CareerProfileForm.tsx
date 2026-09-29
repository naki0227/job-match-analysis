import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  careerAxisKeys,
  careerProfilePayloadSchema,
  type CareerProfilePayload,
} from "@job-match/contracts";
import { AxisQuestion, type AxisDraft } from "./AxisQuestion";
import { prefectures } from "./assessment-catalog";
import {
  CareerProfileApiError,
  loadCareerProfile,
  saveCareerProfile,
} from "./career-profile-api";
import "./career-profile.css";

type AxisKey = (typeof careerAxisKeys)[number];
type Props = { getAccessToken: () => Promise<string> };

export function CareerProfileForm({ getAccessToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [targetRole, setTargetRole] = useState("");
  const [otherTargetRoles, setOtherTargetRoles] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Partial<Record<AxisKey, AxisDraft>>>(
    {},
  );
  const [salary, setSalary] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [fullRemoteRequired, setFullRemoteRequired] = useState(false);
  const [message, setMessage] = useState("");
  const pendingRequest = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const token = await getAccessToken();
        const latest = await loadCareerProfile(token);
        if (!active) return;
        if (latest) {
          setProfileVersion(latest.profileVersion);
          setTargetRole(latest.profile.targetRoles[0] ?? "");
          setOtherTargetRoles(latest.profile.targetRoles.slice(1));
          setAnswers(
            Object.fromEntries(
              latest.profile.axisValues.map((axis) => [
                axis.axisKey,
                { preference: axis.preference, importance: axis.importance },
              ]),
            ),
          );
          setSalary(String(latest.profile.constraints.minSalary?.amount ?? ""));
          setLocations([...latest.profile.constraints.allowedPrefectureCodes]);
          setFullRemoteRequired(latest.profile.constraints.fullRemoteRequired);
        }
      } catch {
        if (active) {
          setLoadFailed(true);
          setMessage(
            "保存済みの診断を読み込めませんでした。再読み込みしてください。",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, [getAccessToken]);

  function setAnswer(axisKey: AxisKey, answer: AxisDraft) {
    setAnswers((current) => ({ ...current, [axisKey]: answer }));
    setMessage("");
  }

  function toggleLocation(code: string, checked: boolean) {
    setLocations((current) =>
      checked
        ? [...current, code]
        : current.filter((location) => location !== code),
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setMessage("");
    const candidate = {
      axisCatalogVersion: 1,
      targetRoles: [targetRole, ...otherTargetRoles],
      axisValues: careerAxisKeys.map((axisKey) => ({
        axisKey,
        axisVersion: 1,
        preference: answers[axisKey]?.preference,
        importance: answers[axisKey]?.importance,
      })),
      constraints: {
        ...(salary.trim() === ""
          ? {}
          : {
              minSalary: {
                amount: Number(salary),
                currency: "JPY",
                period: "year",
              },
            }),
        allowedPrefectureCodes: [...locations].sort(),
        fullRemoteRequired,
      },
    };
    const parsed = careerProfilePayloadSchema.safeParse(candidate);
    if (!parsed.success) {
      setMessage(
        "希望職種と8軸すべての希望値・重要度を入力し、必須条件を確認してください。",
      );
      return;
    }

    const profile: CareerProfilePayload = parsed.data;
    const fingerprint = JSON.stringify({
      expectedVersion: profileVersion,
      profile,
    });
    const idempotencyKey =
      pendingRequest.current?.fingerprint === fingerprint
        ? pendingRequest.current.key
        : crypto.randomUUID();
    pendingRequest.current = { fingerprint, key: idempotencyKey };
    setSaving(true);
    try {
      const token = await getAccessToken();
      const saved = await saveCareerProfile(token, {
        expectedVersion: profileVersion,
        idempotencyKey,
        profile,
      });
      setProfileVersion(saved.profileVersion);
      setTargetRole(saved.profile.targetRoles[0] ?? "");
      pendingRequest.current = null;
      setMessage(`第${saved.profileVersion}版を保存しました。`);
    } catch (error) {
      if (error instanceof CareerProfileApiError && error.kind === "conflict") {
        setMessage(
          "他の画面で診断が更新されました。再読み込みしてから入力してください。",
        );
      } else if (
        error instanceof CareerProfileApiError &&
        error.kind === "unauthorized"
      ) {
        setMessage("ログインが必要です。再読み込みしてログインしてください。");
      } else {
        setMessage("保存できませんでした。同じ内容で再試行できます。");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>診断を読み込み中です。</p>;

  return (
    <section
      className="career-profile"
      aria-labelledby="career-profile-heading"
    >
      <h1 id="career-profile-heading">仕事の希望を入力</h1>
      <p>
        希望と重要度を別々に入力します。結果は採否や能力の判定ではありません。
      </p>
      <p>
        現在の確定版:{" "}
        {profileVersion === 0 ? "未保存" : `第${profileVersion}版`}
      </p>
      <form onSubmit={(event) => void handleSave(event)}>
        <div className="form-field">
          <label htmlFor="target-role">希望職種</label>
          <input
            id="target-role"
            type="text"
            value={targetRole}
            onChange={(event) => setTargetRole(event.target.value)}
            required
          />
          {otherTargetRoles.length > 0 && (
            <p className="field-hint">
              保存済みの他の希望職種も維持します: {otherTargetRoles.join("、")}
            </p>
          )}
        </div>

        <h2>仕事観の8軸</h2>
        <p>
          各軸の「回答する」から入力を始めてください。スライダーは矢印キーでも操作できます。
        </p>
        <div className="axis-list">
          {careerAxisKeys.map((axisKey) => (
            <AxisQuestion
              key={axisKey}
              axisKey={axisKey}
              answer={
                answers[axisKey] ?? { preference: null, importance: null }
              }
              onChange={(answer) => setAnswer(axisKey, answer)}
            />
          ))}
        </div>

        <h2>必須条件</h2>
        <div className="form-field">
          <label htmlFor="min-salary">最低年収（円、額面）</label>
          <input
            id="min-salary"
            type="number"
            min="1"
            step="1"
            value={salary}
            onChange={(event) => setSalary(event.target.value)}
          />
          <p className="field-hint">
            指定しない場合は空欄のままにしてください。
          </p>
        </div>
        <details className="locations">
          <summary>許容する勤務地（{locations.length}都道府県を選択）</summary>
          <div className="prefecture-grid">
            {prefectures.map(([code, name]) => (
              <label key={code}>
                <input
                  type="checkbox"
                  checked={locations.includes(code)}
                  onChange={(event) =>
                    toggleLocation(code, event.target.checked)
                  }
                />
                {name}
              </label>
            ))}
          </div>
        </details>
        <label className="remote-option">
          <input
            type="checkbox"
            checked={fullRemoteRequired}
            onChange={(event) => setFullRemoteRequired(event.target.checked)}
          />
          フルリモートを必須にする
        </label>
        <button type="submit" disabled={saving || loadFailed}>
          {saving ? "保存中…" : "診断を保存"}
        </button>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
