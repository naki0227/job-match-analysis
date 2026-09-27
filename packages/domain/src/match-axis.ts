import { AXIS_KEYS, parseAxisKey, type AxisKey } from "./axis.js";
import type { CareerProfileVersion } from "./career-profile.js";
import { getKnownValue, type Observation } from "./observation.js";

export type Anchor = 0 | 50 | 100;
export type EvaluationSource = "job" | "company";

export type AxisEvidence = Readonly<{
  axisKey: AxisKey;
  axisVersion: number;
  observation: Observation<number>;
}>;

export type TargetEvaluation = Readonly<{
  axisCatalogVersion: number;
  axisValues: readonly AxisEvidence[];
}>;

export type AxisComparisonStatus =
  "close" | "different" | "excluded" | "unknown" | "conflicting" | "stale";

export type AxisComparison = Readonly<{
  axisKey: AxisKey;
  source: EvaluationSource;
  preference: number;
  importance: number;
  observation: Observation<Anchor>;
  status: AxisComparisonStatus;
  difference?: number;
}>;

export type TargetComparison =
  | Readonly<{
      status: "comparable";
      source: EvaluationSource;
      axes: readonly AxisComparison[];
    }>
  | Readonly<{
      status: "incompatible";
      source: EvaluationSource;
      reason: "axis_version_mismatch";
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAnchor(value: unknown): Anchor {
  if (value === 0 || value === 50 || value === 100) {
    return value;
  }
  throw new RangeError("Observed axis value must be a documented anchor");
}

function parseObservation(value: unknown): Observation<Anchor> {
  if (!isRecord(value)) {
    throw new TypeError("Axis observation must be an object");
  }
  switch (value.status) {
    case "known":
    case "stale":
      return Object.freeze({
        status: value.status,
        value: parseAnchor(value.value),
      });
    case "unknown":
    case "conflicting":
      if ("value" in value) {
        throw new RangeError("Unverified axis information cannot have a value");
      }
      return Object.freeze({ status: value.status });
    default:
      throw new RangeError("Unknown axis observation status");
  }
}

function indexObservations(
  evidence: readonly AxisEvidence[],
): ReadonlyMap<AxisKey, Observation<Anchor>> {
  if (!Array.isArray(evidence)) {
    throw new TypeError("Axis evidence must be an array");
  }
  const byKey = new Map<AxisKey, Observation<Anchor>>();
  for (const item of evidence) {
    if (!isRecord(item)) {
      throw new TypeError("Axis evidence must be an object");
    }
    const key = parseAxisKey(item.axisKey);
    if (byKey.has(key)) {
      throw new RangeError("Duplicate axis evidence");
    }
    byKey.set(key, parseObservation(item.observation));
  }
  return byKey;
}

export function compareTarget(
  profile: CareerProfileVersion,
  target: TargetEvaluation,
  source: EvaluationSource,
): TargetComparison {
  if (!isRecord(target) || !Array.isArray(target.axisValues)) {
    throw new TypeError("Target evaluation must contain axis values");
  }
  const observations = indexObservations(target.axisValues);
  if (
    target.axisCatalogVersion !== profile.axisCatalogVersion ||
    target.axisValues.some(
      (axis) => axis.axisVersion !== profile.axisCatalogVersion,
    )
  ) {
    return Object.freeze({
      status: "incompatible",
      source,
      reason: "axis_version_mismatch",
    });
  }

  const profileValues = new Map(
    profile.axisValues.map((answer) => [answer.axisKey, answer]),
  );
  const axes: AxisComparison[] = AXIS_KEYS.map((axisKey) => {
    const answer = profileValues.get(axisKey);
    if (answer === undefined) {
      throw new RangeError("Profile is missing an assessment axis");
    }
    const observation =
      observations.get(axisKey) ?? Object.freeze({ status: "unknown" });
    const common = {
      axisKey,
      source,
      preference: answer.preference,
      importance: answer.importance,
      observation,
    };
    if (answer.importance === 0) {
      return Object.freeze({ ...common, status: "excluded" });
    }
    const observedValue = getKnownValue(observation);
    if (observedValue === undefined) {
      const status = observation.status;
      if (status === "known") {
        throw new RangeError("Known axis observation requires a value");
      }
      return Object.freeze({ ...common, status });
    }
    const difference = Math.abs(answer.preference - observedValue);
    return Object.freeze({
      ...common,
      status: difference <= 25 ? "close" : "different",
      difference,
    });
  });

  return Object.freeze({
    status: "comparable",
    source,
    axes: Object.freeze(axes),
  });
}
