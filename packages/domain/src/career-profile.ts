import {
  AXIS_KEYS,
  parseAxisCatalogVersion,
  parseAxisKey,
  type AxisKey,
} from "./axis.js";
import { parsePercentage } from "./percentage.js";
import { parsePrefectureCode, type PrefectureCode } from "./prefecture.js";

export type AxisAnswer = Readonly<{
  axisKey: AxisKey;
  axisVersion: number;
  preference: number;
  importance: number;
}>;

export type SalaryRequirement = Readonly<{
  amount: number;
  currency: "JPY";
  period: "year";
}>;

export type CareerConstraints = Readonly<{
  minSalary?: SalaryRequirement;
  allowedPrefectureCodes?: readonly PrefectureCode[];
  fullRemoteRequired: boolean;
}>;

export type CareerProfileVersion = Readonly<{
  profileVersion: number;
  axisCatalogVersion: number;
  status: "completed";
  axisValues: readonly AxisAnswer[];
  constraints: CareerConstraints;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProfileVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Profile version must be a positive safe integer");
  }
  return value;
}

function parseAxisValues(
  value: unknown,
  catalogVersion: number,
): readonly AxisAnswer[] {
  if (!Array.isArray(value) || value.length !== AXIS_KEYS.length) {
    throw new RangeError("A completed profile requires all eight axes");
  }

  const seen = new Set<AxisKey>();
  const answers: AxisAnswer[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw new TypeError("Axis answer must be an object");
    }

    const axisKey = parseAxisKey(item.axisKey);
    if (seen.has(axisKey)) {
      throw new RangeError("Duplicate assessment axis");
    }
    seen.add(axisKey);

    const axisVersion = parseAxisCatalogVersion(item.axisVersion);
    if (axisVersion !== catalogVersion) {
      throw new RangeError("Mixed assessment axis versions");
    }

    answers.push(
      Object.freeze({
        axisKey,
        axisVersion,
        preference: parsePercentage(item.preference),
        importance: parsePercentage(item.importance),
      }),
    );
  }

  if (AXIS_KEYS.some((key) => !seen.has(key))) {
    throw new RangeError("A completed profile requires all eight axes");
  }
  return Object.freeze(answers);
}

function parseSalary(value: unknown): SalaryRequirement {
  if (!isRecord(value)) {
    throw new TypeError("Minimum salary must be an object");
  }
  if (
    typeof value.amount !== "number" ||
    !Number.isSafeInteger(value.amount) ||
    value.amount < 1
  ) {
    throw new RangeError("Minimum salary must be a positive integer amount");
  }
  if (value.currency !== "JPY" || value.period !== "year") {
    throw new RangeError("Minimum salary must use JPY per year");
  }
  return Object.freeze({
    amount: value.amount,
    currency: "JPY",
    period: "year",
  });
}

function parseAllowedPrefectures(value: unknown): readonly PrefectureCode[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RangeError("Allowed prefectures must be a nonempty array");
  }
  const codes = value.map(parsePrefectureCode);
  if (new Set(codes).size !== codes.length) {
    throw new RangeError("Duplicate prefecture code");
  }
  return Object.freeze(codes);
}

function parseConstraints(value: unknown): CareerConstraints {
  if (!isRecord(value)) {
    throw new TypeError("Career constraints must be an object");
  }
  if (typeof value.fullRemoteRequired !== "boolean") {
    throw new TypeError("Full remote requirement must be a boolean");
  }

  return Object.freeze({
    ...(value.minSalary === undefined
      ? {}
      : { minSalary: parseSalary(value.minSalary) }),
    ...(value.allowedPrefectureCodes === undefined
      ? {}
      : {
          allowedPrefectureCodes: parseAllowedPrefectures(
            value.allowedPrefectureCodes,
          ),
        }),
    fullRemoteRequired: value.fullRemoteRequired,
  });
}

/** Build a validated, immutable completed profile snapshot. */
export function createCareerProfileVersion(
  value: unknown,
): CareerProfileVersion {
  if (!isRecord(value)) {
    throw new TypeError("Career profile must be an object");
  }
  if (value.status !== undefined && value.status !== "completed") {
    throw new RangeError("Only completed profiles are supported here");
  }

  const axisCatalogVersion = parseAxisCatalogVersion(value.axisCatalogVersion);
  return Object.freeze({
    profileVersion: parseProfileVersion(value.profileVersion),
    axisCatalogVersion,
    status: "completed",
    axisValues: parseAxisValues(value.axisValues, axisCatalogVersion),
    constraints: parseConstraints(value.constraints),
  });
}

/** A revision is a new snapshot; the previous completed version is untouched. */
export function reviseCareerProfileVersion(
  previous: CareerProfileVersion,
  revision: unknown,
): CareerProfileVersion {
  const current = createCareerProfileVersion(previous);
  if (!isRecord(revision)) {
    throw new TypeError("Career profile revision must be an object");
  }
  if (current.profileVersion === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Profile version cannot be incremented");
  }

  return createCareerProfileVersion({
    profileVersion: current.profileVersion + 1,
    axisCatalogVersion: revision.axisCatalogVersion,
    axisValues: revision.axisValues,
    constraints: revision.constraints,
  });
}
