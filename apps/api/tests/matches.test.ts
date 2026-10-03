import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { careerAxisKeys } from "@job-match/contracts";
import {
  MatchStoreError,
  createMatchRepository,
} from "../src/repositories/matches.js";

const evaluationId = randomUUID();
const companyEvaluationId = randomUUID();
const matchResultId = randomUUID();
const userId = randomUUID();
const at = "2026-09-20T01:02:03+00:00";

function snapshot(id: string) {
  return {
    evaluationId: id,
    evaluatedAt: at,
    axisCatalogVersion: 1,
    axisValues: [
      {
        axisKey: "work_location",
        axisVersion: 1,
        observationStatus: "known",
        anchorValue: 50,
      },
      {
        axisKey: "autonomy",
        axisVersion: 1,
        observationStatus: "unknown",
        anchorValue: null,
      },
    ],
    evidence: [
      {
        axisKey: "work_location",
        quote: "週3日オフィス勤務",
        sourceUrl: "https://jobs.example.org/match",
        fetchedAt: at,
      },
    ],
  };
}

const evaluationRow = {
  targetType: "job",
  companyName: "Sample Match Co",
  jobTitle: "Sample Engineer",
  evaluation: snapshot(evaluationId),
  companyEvaluation: snapshot(companyEvaluationId),
};

test("評価をdomainの観測値に変換し、未評価はnullにする", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const repository = createMatchRepository(
    async (name, args) => {
      calls.push([name, args]);
      return args.p_evaluation_id === evaluationId ? evaluationRow : null;
    },
    async () => [
      {
        kind: "salary",
        payload: {
          status: "known",
          value: {
            minimum: 6_000_000,
            maximum: 8_000_000,
            currency: "JPY",
            period: "year",
          },
        },
      },
      {
        kind: "location",
        payload: { status: "known", value: ["東京都", "大阪府"] },
      },
      {
        kind: "fullRemote",
        payload: { status: "known", value: false },
      },
    ],
  );
  const source = await repository.readEvaluation(evaluationId);
  assert.deepEqual(calls[0], [
    "read_evaluation_for_match",
    { p_evaluation_id: evaluationId },
  ]);
  assert.deepEqual(source?.evaluation.axisValues, [
    {
      axisKey: "work_location",
      axisVersion: 1,
      observation: { status: "known", value: 50 },
    },
    { axisKey: "autonomy", axisVersion: 1, observation: { status: "unknown" } },
  ]);
  assert.deepEqual(source?.jobConditions, {
    salary: {
      status: "known",
      value: {
        minimum: 6_000_000,
        maximum: 8_000_000,
        currency: "JPY",
        period: "year",
      },
    },
    availablePrefectureCodes: { status: "known", value: ["13", "27"] },
    fullRemote: { status: "known", value: false },
  });
  assert.equal(source?.companyEvaluation?.evaluationId, companyEvaluationId);
  assert.equal(await repository.readEvaluation(randomUUID()), null);
});

test("DB応答の矛盾・RPC失敗は内部詳細を出さない保存エラーにする", async () => {
  const corrupt = structuredClone(evaluationRow);
  corrupt.evaluation.axisValues[0]!.anchorValue = null as unknown as number;
  for (const rpc of [
    async () => corrupt,
    async () => ({ ...evaluationRow, targetType: "person" }),
    async () => {
      throw new Error("relation does not exist");
    },
  ]) {
    await assert.rejects(
      createMatchRepository(rpc).readEvaluation(evaluationId),
      MatchStoreError,
    );
  }
});

test("Match保存は1 RPCで軸と必須条件のsnapshotを渡す", async () => {
  let captured: Record<string, unknown> = {};
  const repository = createMatchRepository(async (name, args) => {
    assert.equal(name, "commit_match_result");
    captured = args;
    return [{ match_result_id: matchResultId, created_at: at, created: true }];
  });
  const result = await repository.commitMatch({
    userId,
    profileVersionId: randomUUID(),
    evaluationId,
    algorithmVersion: "match-engine-v1",
    axes: [
      {
        axisKey: "work_location",
        source: "job",
        preference: 60,
        importance: 50,
        observation: { status: "known", value: 50 },
        status: "close",
        difference: 10,
      },
      {
        axisKey: "autonomy",
        source: "job",
        preference: 60,
        importance: 50,
        observation: { status: "unknown" },
        status: "unknown",
      },
      {
        axisKey: "role_breadth",
        source: "job",
        preference: 100,
        importance: 50,
        observation: { status: "range", minimum: 50, maximum: 100 },
        status: "partial",
        difference: 0,
        differenceMax: 50,
      },
    ],
    constraints: [
      { kind: "min_salary", status: "unknown", reason: "missing_information" },
      { kind: "location", status: "not_required" },
    ],
  });
  assert.deepEqual(result, { matchResultId, createdAt: at, created: true });
  assert.deepEqual(captured.p_axes, [
    {
      axisKey: "work_location",
      preference: 60,
      importance: 50,
      observationStatus: "known",
      observedAnchor: 50,
      observedAnchorMax: null,
      comparisonStatus: "close",
      difference: 10,
      differenceMax: null,
    },
    {
      axisKey: "autonomy",
      preference: 60,
      importance: 50,
      observationStatus: "unknown",
      observedAnchor: null,
      observedAnchorMax: null,
      comparisonStatus: "unknown",
      difference: null,
      differenceMax: null,
    },
    {
      axisKey: "role_breadth",
      preference: 100,
      importance: 50,
      observationStatus: "range",
      observedAnchor: 50,
      observedAnchorMax: 100,
      comparisonStatus: "partial",
      difference: 0,
      differenceMax: 50,
    },
  ]);
  assert.deepEqual(captured.p_constraints, [
    { kind: "min_salary", status: "unknown", reason: "missing_information" },
    { kind: "location", status: "not_required", reason: null },
  ]);
  await assert.rejects(
    createMatchRepository(async () => []).commitMatch({
      userId,
      profileVersionId: randomUUID(),
      evaluationId,
      algorithmVersion: "v",
      axes: [],
      constraints: [],
    }),
    MatchStoreError,
  );
});

test("保存済みMatchを軸カタログ順で読み、他人・不在はnullにする", async () => {
  const axes = [...careerAxisKeys].reverse().map((axisKey) => ({
    axisKey,
    preference: 40,
    importance: axisKey === "work_change" ? 0 : 50,
    observationStatus: "unknown",
    observedAnchor: null,
    comparisonStatus: axisKey === "work_change" ? "excluded" : "unknown",
    difference: null,
  }));
  const repository = createMatchRepository(async (name, args) => {
    assert.equal(name, "read_match_result");
    if (args.p_user_id !== userId) return null;
    return {
      matchResultId,
      createdAt: at,
      algorithmVersion: "match-engine-v1",
      evaluationId,
      profileVersion: 2,
      axisCatalogVersion: 1,
      axes,
      constraints: [
        { kind: "min_salary", status: "not_required", reason: null },
        { kind: "location", status: "unknown", reason: "missing_information" },
        { kind: "full_remote", status: "not_required", reason: null },
      ],
    };
  });
  const stored = await repository.readMatch(userId, matchResultId);
  assert.deepEqual(
    stored?.axes.map((axis) => axis.axisKey),
    [...careerAxisKeys],
  );
  assert.equal(stored?.axes[0]?.source, "job");
  assert.deepEqual(stored?.constraints[0], {
    kind: "min_salary",
    status: "not_required",
  });
  assert.equal(await repository.readMatch(randomUUID(), matchResultId), null);
});

test("範囲の観測を読み、隣接しない範囲や片側だけの値は保存エラーにする", async () => {
  const withAxis = (axis: Record<string, unknown>) => ({
    ...evaluationRow,
    evaluation: {
      ...snapshot(evaluationId),
      axisValues: [{ axisKey: "role_breadth", axisVersion: 1, ...axis }],
    },
  });
  const source = await createMatchRepository(async () =>
    withAxis({ observationStatus: "range", anchorValue: 50, anchorMax: 100 }),
  ).readEvaluation(evaluationId);
  assert.deepEqual(source?.evaluation.axisValues[0]?.observation, {
    status: "range",
    minimum: 50,
    maximum: 100,
  });
  for (const axis of [
    { observationStatus: "range", anchorValue: 0, anchorMax: 100 },
    { observationStatus: "range", anchorValue: 50, anchorMax: null },
    { observationStatus: "known", anchorValue: 50, anchorMax: 100 },
  ]) {
    await assert.rejects(
      createMatchRepository(async () => withAxis(axis)).readEvaluation(
        evaluationId,
      ),
      MatchStoreError,
    );
  }
});

test("保存済みMatchの範囲と最大差を復元する", async () => {
  const axes = careerAxisKeys.map((axisKey) =>
    axisKey === "role_breadth"
      ? {
          axisKey,
          preference: 100,
          importance: 50,
          observationStatus: "range",
          observedAnchor: 50,
          observedAnchorMax: 100,
          comparisonStatus: "partial",
          difference: 0,
          differenceMax: 50,
        }
      : {
          axisKey,
          preference: 40,
          importance: 50,
          observationStatus: "unknown",
          observedAnchor: null,
          comparisonStatus: "unknown",
          difference: null,
        },
  );
  const stored = await createMatchRepository(async () => ({
    matchResultId,
    createdAt: at,
    algorithmVersion: "match-engine-v3",
    evaluationId,
    profileVersion: 2,
    axisCatalogVersion: 1,
    axes,
    constraints: [
      { kind: "min_salary", status: "not_required", reason: null },
      { kind: "location", status: "not_required", reason: null },
      { kind: "full_remote", status: "not_required", reason: null },
    ],
  })).readMatch(userId, matchResultId);
  assert.deepEqual(
    stored?.axes.find((axis) => axis.axisKey === "role_breadth"),
    {
      axisKey: "role_breadth",
      source: "job",
      preference: 100,
      importance: 50,
      observation: { status: "range", minimum: 50, maximum: 100 },
      status: "partial",
      difference: 0,
      differenceMax: 50,
    },
  );
});
