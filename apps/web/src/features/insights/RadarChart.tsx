import {
  defaultRadar,
  labelPoint,
  polygonPoints,
  radarPoint,
} from "./radar-geometry";

export type RadarAxis = { key: string; label: string; value: number };

type Props = {
  title: string;
  axes: readonly RadarAxis[];
};

const rings = [25, 50, 75, 100];

/** One series; the per-axis table next to it carries the exact values. */
export function RadarChart({ title, axes }: Props) {
  const count = axes.length;
  const { size, center } = defaultRadar;

  return (
    <svg
      className="radar"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${title}（値は下の表を参照）`}
    >
      {rings.map((ring) => (
        <polygon
          key={ring}
          className="radar-grid"
          points={polygonPoints(Array(count).fill(ring))}
        />
      ))}
      {axes.map((axis, index) => {
        const end = radarPoint(index, count, 100);
        const label = labelPoint(index, count);
        const anchor =
          Math.abs(label.x - center) < 4
            ? "middle"
            : label.x > center
              ? "start"
              : "end";
        return (
          <g key={axis.key}>
            <line
              className="radar-axis"
              x1={center}
              y1={center}
              x2={end.x}
              y2={end.y}
            />
            <text
              className="radar-label"
              x={label.x}
              y={label.y}
              textAnchor={anchor}
              dominantBaseline="middle"
            >
              {axis.label}
            </text>
          </g>
        );
      })}
      <polygon
        className="radar-self"
        points={polygonPoints(axes.map((axis) => axis.value))}
      />
      {axes.map((axis, index) => {
        const point = radarPoint(index, count, axis.value);
        return (
          <g key={axis.key} className="radar-point">
            <circle className="radar-hit" cx={point.x} cy={point.y} r={14}>
              <title>{`${axis.label}: ${axis.value}`}</title>
            </circle>
            <circle className="radar-dot" cx={point.x} cy={point.y} r={5} />
          </g>
        );
      })}
    </svg>
  );
}
