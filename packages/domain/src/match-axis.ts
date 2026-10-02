import { AXIS_KEYS, parseAxisKey, type AxisKey } from "./axis.js";
import type { CareerProfileVersion } from "./career-profile.js";
import { getKnownValue, type Observation } from "./observation.js";

export type Anchor = 0 | 50 | 100;
export type EvaluationSource = "job" | "company";

/**
 * The posting supports two adjacent anchors but the evidence does not justify
 * choosing one of them (ADR-049). The pair is ambiguity between documented
 * anchors, not an estimate that the true value lies continuously between them.
 */
export type AnchorRange = Readonly<{
  status: "range";
  minimum: 0 | 50;
  maximum: 50 | 100;
}>;

export type AxisObservation = Observation<Anchor> | AnchorRange;

export type AxisEvidence = Readonly<{
  axisKey: AxisKey;
  axisVersion: number;
  observation: Observation<number> | AnchorRange;
}>;

export type TargetEvaluation = Readonly<{
  axisCatalogVersion: number;
  axisValues: readonly AxisEvidence[];
}>;

/**
 * `partial`: the preference is close to one end of an observed range and
 * far from the other, so the posting neither confirms nor rules it out.
 */
export type AxisComparisonStatus =
  | "close"
  | "different"
  | "partial"
  | "excluded"
  | "unknown"
  | "conflicting"
  | "stale";

export type AxisComparison = Readonly<{
  axisKey: AxisKey;
  source: EvaluationSource;
  preference: number;
  importance: number;
  observation: AxisObservation;
  status: AxisComparisonStatus;
  /** Smallest possible difference; the only difference for one anchor. */
  difference?: number;
  /** Largest possible difference, for a range observation only. */
  differenceMax?: number;
}>;

/** A difference at or below this is close. */
const CLOSE_DIFFERENCE = 25;

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

function parseObservation(value: unknown): AxisObservation {
  if (!isRecord(value)) {
    throw new TypeError("Axis observation must be an object");
  }
  switch (value.status) {
    case "range": {
      const minimum = parseAnchor(value.minimum);
      const maximum = parseAnchor(value.maximum);
      if (minimum === 100 || maximum === 0 || maximum - minimum !== 50) {
        throw new RangeError("An axis range spans two adjacent anchors");
      }
      return Object.freeze({ status: "range", minimum, maximum });
    }
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
): ReadonlyMap<AxisKey, AxisObservation> {
  if (!Array.isArray(evidence)) {
    throw new TypeError("Axis evidence must be an array");
  }
  const byKey = new Map<AxisKey, AxisObservation>();
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
    if (observation.status === "range") {
      const toMinimum = Math.abs(answer.preference - observation.minimum);
      const toMaximum = Math.abs(answer.preference - observation.maximum);
      const difference = Math.min(toMinimum, toMaximum);
      const differenceMax = Math.max(toMinimum, toMaximum);
      return Object.freeze({
        ...common,
        status:
          differenceMax <= CLOSE_DIFFERENCE
            ? "close"
            : difference > CLOSE_DIFFERENCE
              ? "different"
              : "partial",
        difference,
        differenceMax,
      });
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
      status: difference <= CLOSE_DIFFERENCE ? "close" : "different",
      difference,
    });
  });

  return Object.freeze({
    status: "comparable",
    source,
    axes: Object.freeze(axes),
  });
}
