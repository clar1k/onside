"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export type ChartSeries = {
  label: string;
  color: string;
  points: { t: number; pct: number }[];
  dashed?: boolean;
};

/** Catmull-Rom → cubic-bezier for a smooth curve through the points. */
function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0][0]},${pts[0][1]}`;
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

const W = 640;
const PAD = { l: 6, r: 44, t: 14, b: 20 };

function fmtClock(t: number) {
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function ProbChart({
  series,
  height = 230,
  className,
}: {
  series: ChartSeries[];
  height?: number;
  className?: string;
}) {
  const H = height;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length < 1) return null;
    const ts = all.map((p) => p.t);
    let tMin = Math.min(...ts);
    let tMax = Math.max(...ts);
    if (tMax === tMin) tMax = tMin + 1;
    const x = (t: number) => PAD.l + ((t - tMin) / (tMax - tMin)) * plotW;
    const y = (pct: number) => PAD.t + (1 - Math.max(0, Math.min(100, pct)) / 100) * plotH;
    return { tMin, tMax, x, y };
  }, [series, plotW, plotH]);

  if (!model) {
    return (
      <div
        className={cn("flex items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900/30 text-sm text-neutral-600", className)}
        style={{ height: H }}
      >
        Waiting for consensus odds…
      </div>
    );
  }

  const { x, y, tMin, tMax } = model;
  const grid = [0, 25, 50, 75, 100];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full", className)} preserveAspectRatio="none" role="img" aria-label="Implied probability over time">
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {/* gridlines + % labels */}
      {grid.map((g) => (
        <g key={g}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(g)}
            y2={y(g)}
            stroke={g === 50 ? "#252c34" : "#1b2026"}
            strokeWidth="1"
            strokeDasharray={g === 50 ? "0" : "3 4"}
          />
          <text x={W - PAD.r + 6} y={y(g) + 3} fontSize="10" fill="#5b616b" className="tabular-nums">
            {g}%
          </text>
        </g>
      ))}

      {/* time axis labels */}
      <text x={PAD.l} y={H - 5} fontSize="10" fill="#5b616b">{fmtClock(tMin)}</text>
      <text x={W - PAD.r} y={H - 5} fontSize="10" fill="#5b616b" textAnchor="end">{fmtClock(tMax)}</text>

      {series.map((s, i) => {
        if (!s.points.length) return null;
        const pts = s.points.map((p) => [x(p.t), y(p.pct)] as [number, number]);
        const line = smoothPath(pts);
        const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)},${y(0)} L ${pts[0][0].toFixed(1)},${y(0)} Z`;
        const last = pts[pts.length - 1];
        const lastPct = s.points[s.points.length - 1].pct;
        return (
          <g key={i}>
            <path d={area} fill={`url(#grad-${i})`} />
            <path d={line} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dashed ? "5 4" : "0"} />
            <circle cx={last[0]} cy={last[1]} r="3.5" fill={s.color} stroke="#181d22" strokeWidth="2" />
            <text x={Math.min(last[0] + 7, W - PAD.r - 2)} y={last[1] - 7} fontSize="11" fontWeight="700" fill={s.color} className="tabular-nums">
              {Math.round(lastPct)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Tiny inline sparkline (no axes) for cards. */
export function Sparkline({
  points,
  color = "#34d399",
  className,
  width = 96,
  height = 28,
}: {
  points: { t: number; pct: number }[];
  color?: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return <span className={cn("inline-block", className)} style={{ width, height }} />;
  const ts = points.map((p) => p.t);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts) || tMin + 1;
  const x = (t: number) => (tMax === tMin ? 0 : ((t - tMin) / (tMax - tMin)) * (width - 4) + 2);
  const y = (pct: number) => height - 3 - (Math.max(0, Math.min(100, pct)) / 100) * (height - 6);
  const pts = points.map((p) => [x(p.t), y(p.pct)] as [number, number]);
  const up = points[points.length - 1].pct >= points[0].pct;
  const stroke = up ? color : "#f87171";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden="true">
      <path d={smoothPath(pts)} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
