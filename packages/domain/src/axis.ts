export const AXIS_CATALOG_VERSION = 1;

export const AXIS_KEYS = Object.freeze([
  "work_location",
  "autonomy",
  "collaboration",
  "growth_direction",
  "work_change",
  "schedule_flexibility",
  "role_breadth",
  "customer_contact",
] as const);

export type AxisKey = (typeof AXIS_KEYS)[number];

export function parseAxisKey(value: unknown): AxisKey {
  const key = AXIS_KEYS.find((candidate) => candidate === value);
  if (key === undefined) {
    throw new RangeError("Unknown assessment axis");
  }
  return key;
}

export function parseAxisCatalogVersion(value: unknown): number {
  if (value !== AXIS_CATALOG_VERSION) {
    throw new RangeError("Unsupported assessment axis version");
  }
  return AXIS_CATALOG_VERSION;
}
