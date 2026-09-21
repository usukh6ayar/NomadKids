import { useId } from "react";
import { cn } from "@/lib/utils";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { clampPercent, STROKE } from "./chart-tokens";

export function LineChart({
  points,
  label,
  tone = "sky",
  className,
}: {
  points: { label: string; value: number }[];
  label: string;
  tone?: Tone;
  className?: string;
}) {
  const gradientId = useId().replaceAll(":", "");
  const usable = points.filter((point) => Number.isFinite(point.value));

  if (usable.length === 0) {
    return (
      <div role="img" aria-label={`${label} — мэдээлэлгүй`} className={cn("h-40", className)} />
    );
  }

  const coordinates = usable.map((point, index) => {
    const x = usable.length === 1 ? 50 : 4 + (index / (usable.length - 1)) * 92;
    const y = 36 - (clampPercent(point.value) / 100) * 30;
    return { ...point, x, y };
  });
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `4,36 ${line} 96,36`;
  const labels = [usable[0], usable[Math.floor((usable.length - 1) / 2)], usable.at(-1)].filter(
    (point, index, all) => point && all.findIndex((item) => item?.label === point.label) === index,
  );

  return (
    <div className={cn("min-w-0", className)}>
      <svg
        role="img"
        aria-label={`${label}: ${usable.map((point) => `${point.label} ${point.value}%`).join(", ")}`}
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-40 w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE_VAR[tone]} stopOpacity="0.24" />
            <stop offset="100%" stopColor={TONE_VAR[tone]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[6, 21, 36].map((y) => (
          <line
            key={y}
            x1="4"
            x2="96"
            y1={y}
            y2={y}
            stroke="var(--color-border-soft)"
            strokeWidth={STROKE.grid}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={TONE_VAR[tone]}
          strokeWidth={STROKE.data}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {coordinates.map((point) => (
          <circle
            key={point.label}
            cx={point.x}
            cy={point.y}
            r="1.2"
            fill="var(--color-surface)"
            stroke={TONE_VAR[tone]}
            strokeWidth={STROKE.data}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div aria-hidden="true" className="mt-1 flex justify-between text-caption text-faint">
        {labels.map((point) => (
          <span key={point!.label}>{point!.label}</span>
        ))}
      </div>
    </div>
  );
}
