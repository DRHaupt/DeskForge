"use client";

import { useId, useMemo, useRef, useState } from "react";
import { compact, niceMax } from "@/core/reports/stats";

type Series = { name: string; values: number[]; color: string };

const shortDay = (key: string) => {
  const [, m, d] = key.split("-");
  return `${Number(d)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}`;
};

/** Daily line chart: one y-axis, 2px lines, crosshair tooltip listing every series, legend + end labels, table view. */
export function TrendChart({ days, series, label }: { days: string[]; series: Series[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const tableId = useId();
  const W = 720;
  const H = 240;
  const pad = { l: 36, r: 64, t: 12, b: 28 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => pad.l + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  function locate(clientX: number) {
    const svg = svgRef.current;
    if (!svg || !days.length) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  }

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden>
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} /> {s.name}
          </span>
        ))}
        <button type="button" className="ml-auto underline-offset-2 hover:underline" aria-controls={tableId} aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Hide table" : "Show as table"}
        </button>
      </div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label={`${label}. ${series.map((s) => `${s.name}: ${s.values.reduce((a, b) => a + b, 0)} in total`).join("; ")}.`}
          tabIndex={0}
          onPointerMove={(e) => locate(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(days.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? days.length) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(days.length - 1, (h ?? -1) + 1));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {compact(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 || i === days.length - 1 ? (
              <text key={d} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
                {shortDay(d)}
              </text>
            ) : null,
          )}
          {series.map((s) => (
            <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
          ))}
          {/* End labels: value at the line end, in text ink beside a colored marker. */}
          {series.map((s) => {
            const last = s.values[s.values.length - 1] ?? 0;
            return (
              <g key={`end-${s.name}`}>
                <circle cx={x(days.length - 1)} cy={y(last)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              </g>
            );
          })}
          <EndLabels series={series} x={x(days.length - 1) + 8} y={y} />
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--chart-axis)" strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-32 rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
          >
            <div className="mb-1 text-muted-foreground">{shortDay(days[hover]!)}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                <span className="font-semibold tabular-nums text-foreground">{s.values[hover]}</span>
                <span className="text-muted-foreground">{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <figcaption className="sr-only">{label}</figcaption>
      {showTable && (
        <div id={tableId} className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                {series.map((s) => (
                  <th key={s.name} className="px-3 py-1.5 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {days.map((d, i) => (
                <tr key={d} className="border-t">
                  <td className="px-3 py-1">{d}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-3 py-1 text-right">
                      {s.values[i]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/** End labels with simple collision avoidance: if two would overlap, fall back to the legend. */
function EndLabels({ series, x, y }: { series: Series[]; x: number; y: (v: number) => number }) {
  const ys = series.map((s) => y(s.values[s.values.length - 1] ?? 0));
  const collide = ys.some((a, i) => ys.some((b, j) => i !== j && Math.abs(a - b) < 14));
  if (collide) return null;
  return (
    <>
      {series.map((s, i) => (
        <text key={s.name} x={x} y={ys[i]} dy="0.32em" className="fill-foreground text-[11px] font-medium tabular-nums">
          {s.values[s.values.length - 1]} {s.name.toLowerCase()}
        </text>
      ))}
    </>
  );
}

/** Horizontal bars for one series: ≤ 20px thick, rounded data end, value at the tip, per-bar hover/focus readout. */
export function BarList({ rows, label, color = "var(--series-1)", format = (n: number) => compact(n) }: { rows: { label: string; n: number }[]; label: string; color?: string; format?: (n: number) => string }) {
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.n)), [rows]);
  if (!rows.length || rows.every((r) => r.n === 0)) return <p className="text-sm text-muted-foreground">Nothing to show for this period.</p>;
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label} className="group grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 text-sm" tabIndex={0} aria-label={`${r.label}: ${format(r.n)}`}>
          <span className="truncate text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-4 rounded-r-[4px] transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
              style={{ width: `${(r.n / max) * 85}%`, minWidth: r.n > 0 ? 2 : 0, background: color }}
              title={`${r.label}: ${format(r.n)}`}
            />
            <span className="tabular-nums">{format(r.n)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
