export type Point = { x: number; y: number };

export type RadarGeometry = {
  size: number;
  center: number;
  radius: number;
};

export const defaultRadar: RadarGeometry = {
  size: 420,
  center: 210,
  radius: 150,
};

/** Axis i points up first and proceeds clockwise. value is 0..100. */
export function radarPoint(
  index: number,
  count: number,
  value: number,
  geometry: RadarGeometry = defaultRadar,
): Point {
  if (count < 3) throw new RangeError("A radar needs at least three axes");
  const clamped = Math.min(Math.max(value, 0), 100);
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
  const distance = (geometry.radius * clamped) / 100;
  return {
    x: round(geometry.center + distance * Math.cos(angle)),
    y: round(geometry.center + distance * Math.sin(angle)),
  };
}

export function polygonPoints(
  values: readonly number[],
  geometry: RadarGeometry = defaultRadar,
): string {
  return values
    .map((value, index) => {
      const point = radarPoint(index, values.length, value, geometry);
      return `${point.x},${point.y}`;
    })
    .join(" ");
}

/** Labels sit just outside the outer ring. */
export function labelPoint(
  index: number,
  count: number,
  geometry: RadarGeometry = defaultRadar,
): Point {
  return radarPoint(index, count, 100 + (36 / geometry.radius) * 100, {
    ...geometry,
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
