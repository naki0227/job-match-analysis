/** Public job/company information is distinct from a hard-constraint result. */
export type Observation<T> =
  | Readonly<{ status: "known"; value: T }>
  | Readonly<{ status: "unknown" }>
  | Readonly<{ status: "conflicting" }>
  | Readonly<{ status: "stale"; value: T }>;

/** No numeric fallback is provided for missing, conflicting, or stale facts. */
export function getKnownValue<T>(observation: Observation<T>): T | undefined {
  return observation.status === "known" ? observation.value : undefined;
}
