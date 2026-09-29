import { careerAxisKeys } from "@job-match/contracts";
import { useState } from "react";
import { Mascot } from "../../components/Mascot";
import { PendingFeature } from "../../components/PendingFeature";
import { axisQuestions } from "../career-profile/assessment-catalog";
import { useCareerProfile } from "../career-profile/useCareerProfile";
import { axisNames } from "../result/match-report";
import { RadarChart } from "./RadarChart";
import "./insights.css";

type Props = { onEditProfile: () => void };

const cohorts = ["同じ希望職種", "全体", "同じ地域", "同じ学部"] as const;

/** The user's own eight axes; cohort comparison waits for consented stats. */
export function InsightsScreen({ onEditProfile }: Props) {
  const profile = useCareerProfile();
  const [cohort, setCohort] = useState<(typeof cohorts)[number]>(cohorts[0]);

  if (profile.isPending) return <p role="status">読み込み中です。</p>;
  if (profile.isError) {
    return (
      <p className="notice danger" role="alert">
        希望条件を読み込めませんでした。時間をおいて再試行してください。
      </p>
    );
  }

  return (
    <section
      className="page-head insight-wrap"
      aria-labelledby="insights-heading"
    >
      <div className="eyebrow">INSIGHTS</div>
      <h1 id="insights-heading">自分の8軸</h1>
      <p className="sub">希望条件の最新版を、8つの軸で見る。</p>
      {profile.data === null ? (
        <div className="empty">
          <Mascot pose="point" size="small" />
          <p>希望条件を保存すると、ここに8軸が表示されます。</p>
          <div className="actions centered">
            <button className="primary" type="button" onClick={onEditProfile}>
              希望条件を入力する
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="insight-grid">
            <RadarChart
              title={`あなたの希望（第${profile.data.profileVersion}版）`}
              axes={careerAxisKeys.map((key) => ({
                key,
                label: axisNames[key],
                value:
                  profile.data?.profile.axisValues.find(
                    (axis) => axis.axisKey === key,
                  )?.preference ?? 0,
              }))}
            />
            <table className="axis-table">
              <caption>
                あなたの希望（第{profile.data.profileVersion}版）
              </caption>
              <thead>
                <tr>
                  <th scope="col">軸</th>
                  <th scope="col">希望値</th>
                  <th scope="col">重視度</th>
                </tr>
              </thead>
              <tbody>
                {profile.data.profile.axisValues.map((axis) => (
                  <tr key={axis.axisKey}>
                    <th scope="row" title={axisQuestions[axis.axisKey].label}>
                      {axisNames[axis.axisKey]}
                    </th>
                    <td>{axis.preference}</td>
                    <td>
                      {axis.importance === 0 ? "比較しない" : axis.importance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="section" aria-labelledby="cohort-heading">
            <h2 id="cohort-heading">みんなと比べる</h2>
            <div className="filterbar" role="group" aria-label="比べる集団">
              {cohorts.map((name) => (
                <button
                  key={name}
                  className="chip"
                  type="button"
                  aria-pressed={cohort === name}
                  onClick={() => setCohort(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <PendingFeature
              title={`「${cohort}」との比較はまだ表示できません`}
              reason="匿名集計への参加同意と、人数が少ない集団を表示しない仕組みの準備中です（Issue #40・#41）。"
            />
          </section>
        </>
      )}
    </section>
  );
}
