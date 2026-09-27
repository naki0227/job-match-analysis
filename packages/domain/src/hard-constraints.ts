import type { CareerConstraints } from "./career-profile.js";
import { getKnownValue, type Observation } from "./observation.js";
import { parsePrefectureCode } from "./prefecture.js";

export type SalaryOffer = Readonly<{
  minimum: number;
  maximum: number;
  currency: string;
  period: string;
}>;

/** A known location list means the job explicitly offers a choice among these locations. */
export type JobConditions = Readonly<{
  salary?: Observation<SalaryOffer>;
  availablePrefectureCodes?: Observation<readonly string[]>;
  fullRemote?: Observation<boolean>;
}>;

export type ConstraintKind = "min_salary" | "location" | "full_remote";
export type ConstraintStatus = "met" | "unmet" | "unknown" | "not_required";
export type ConstraintReason =
  | "missing_information"
  | "conflicting_information"
  | "stale_information"
  | "salary_unit_mismatch"
  | "salary_range_overlaps_minimum"
  | "salary_below_minimum"
  | "location_outside_allowed"
  | "regular_office_attendance_required";

export type ConstraintResult = Readonly<{
  kind: ConstraintKind;
  status: ConstraintStatus;
  reason?: ConstraintReason;
}>;

function result(
  kind: ConstraintKind,
  status: ConstraintStatus,
  reason?: ConstraintReason,
): ConstraintResult {
  return Object.freeze({
    kind,
    status,
    ...(reason === undefined ? {} : { reason }),
  });
}

function missingReason<T>(
  observation: Observation<T> | undefined,
): ConstraintReason {
  switch (observation?.status) {
    case "conflicting":
      return "conflicting_information";
    case "stale":
      return "stale_information";
    default:
      return "missing_information";
  }
}

function validateSalaryOffer(offer: SalaryOffer): void {
  if (
    typeof offer !== "object" ||
    offer === null ||
    !Number.isSafeInteger(offer.minimum) ||
    !Number.isSafeInteger(offer.maximum) ||
    offer.minimum < 0 ||
    offer.maximum < offer.minimum ||
    typeof offer.currency !== "string" ||
    typeof offer.period !== "string"
  ) {
    throw new RangeError("Invalid salary offer");
  }
}

function evaluateSalary(
  constraints: CareerConstraints,
  observation: Observation<SalaryOffer> | undefined,
): ConstraintResult {
  const requirement = constraints.minSalary;
  if (requirement === undefined) {
    return result("min_salary", "not_required");
  }
  const offer =
    observation === undefined ? undefined : getKnownValue(observation);
  if (offer === undefined) {
    return result("min_salary", "unknown", missingReason(observation));
  }
  validateSalaryOffer(offer);
  if (offer.currency !== "JPY" || offer.period !== "year") {
    return result("min_salary", "unknown", "salary_unit_mismatch");
  }
  if (offer.minimum >= requirement.amount) {
    return result("min_salary", "met");
  }
  if (offer.maximum < requirement.amount) {
    return result("min_salary", "unmet", "salary_below_minimum");
  }
  return result("min_salary", "unknown", "salary_range_overlaps_minimum");
}

function evaluateLocation(
  constraints: CareerConstraints,
  observation: Observation<readonly string[]> | undefined,
): ConstraintResult {
  const allowed = constraints.allowedPrefectureCodes;
  if (allowed === undefined) {
    return result("location", "not_required");
  }
  const available =
    observation === undefined ? undefined : getKnownValue(observation);
  if (available === undefined) {
    return result("location", "unknown", missingReason(observation));
  }
  if (!Array.isArray(available) || available.length === 0) {
    throw new RangeError("Available prefectures must be a nonempty array");
  }
  const codes = available.map(parsePrefectureCode);
  return codes.some((code) => allowed.includes(code))
    ? result("location", "met")
    : result("location", "unmet", "location_outside_allowed");
}

function evaluateRemote(
  constraints: CareerConstraints,
  observation: Observation<boolean> | undefined,
): ConstraintResult {
  if (!constraints.fullRemoteRequired) {
    return result("full_remote", "not_required");
  }
  const fullRemote =
    observation === undefined ? undefined : getKnownValue(observation);
  if (fullRemote === undefined) {
    return result("full_remote", "unknown", missingReason(observation));
  }
  if (typeof fullRemote !== "boolean") {
    throw new TypeError("Full remote observation must be boolean");
  }
  return fullRemote
    ? result("full_remote", "met")
    : result("full_remote", "unmet", "regular_office_attendance_required");
}

export function evaluateHardConstraints(
  constraints: CareerConstraints,
  conditions: JobConditions,
): readonly ConstraintResult[] {
  return Object.freeze([
    evaluateSalary(constraints, conditions.salary),
    evaluateLocation(constraints, conditions.availablePrefectureCodes),
    evaluateRemote(constraints, conditions.fullRemote),
  ]);
}
