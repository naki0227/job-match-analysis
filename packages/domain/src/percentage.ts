/** Validate a user-supplied 0..100 slider value without coercion. */
export function parsePercentage(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new RangeError("Value must be an integer between 0 and 100");
  }

  return value;
}
