import React from 'react';
import { formatBytes1, levelColor, type PerfSegment } from '../lib/perfMetrics';

/** Titled box used by the detail view's "right now" section. */
export const PerfCard: React.FC<{ title: string; testId?: string; children: React.ReactNode }> = ({
  title,
  testId,
  children,
}) => (
  <section className="rounded-lg border border-border-subtle bg-app-input p-3 space-y-2" data-testid={testId}>
    <h3 className="text-xs font-medium text-txt-primary">{title}</h3>
    {children}
  </section>
);

const R = 36;
const C = 2 * Math.PI * R;

/** Ring chart. Segment values are relative (they are normalised to their sum). */
export const Donut: React.FC<{
  segments: PerfSegment[];
  center: string;
  sub?: string;
  format?: (v: number) => string;
  label: string;
}> = ({ segments, center, sub, format = (v) => `${Math.round(v)}%`, label }) => {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let offset = 0;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={label}>
        <circle cx={50} cy={50} r={R} fill="none" stroke="currentColor" opacity={0.1} strokeWidth={14} />
        {segments.map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.label}
              cx={50}
              cy={50}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={14}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
        <g className="rotate-90 origin-center" fill="currentColor">
          <text x={50} y={sub ? 49 : 54} textAnchor="middle" fontSize={16} fontWeight={600}>
            {center}
          </text>
          {sub && (
            <text x={50} y={63} textAnchor="middle" fontSize={8} opacity={0.6}>
              {sub}
            </text>
          )}
        </g>
      </svg>
      <ul className="space-y-0.5 text-[11px] text-txt-secondary">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="text-txt-muted">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export interface HBarRow {
  label: string;
  /** 0-100 fill. */
  pct: number;
  right: string;
  color?: string;
  /** Optional 0-100 tick marks (e.g. request / limit). */
  marks?: Array<{ pct: number; label: string }>;
}

/** Horizontal bars, one per row. */
export const HBars: React.FC<{ rows: HBarRow[] }> = ({ rows }) => (
  <ul className="space-y-2">
    {rows.map((r) => (
      <li key={r.label} className="space-y-0.5">
        <div className="flex justify-between gap-2 text-[11px] text-txt-secondary">
          <span className="truncate">{r.label}</span>
          <span className="shrink-0 text-txt-muted">{r.right}</span>
        </div>
        <div className="relative h-2 rounded-full bg-slate-700/50">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(0, r.pct))}%`, background: r.color ?? levelColor(r.pct) }}
          />
          {r.marks?.map((m) => (
            <span
              key={m.label}
              title={m.label}
              className="absolute -top-0.5 h-3 w-0.5 bg-txt-primary/80"
              style={{ left: `${Math.min(100, Math.max(0, m.pct))}%` }}
            />
          ))}
        </div>
      </li>
    ))}
  </ul>
);

/** One vertical bar per CPU core with its index underneath. */
export const CoreChart: React.FC<{ pcts: number[] }> = ({ pcts }) => (
  <div className="flex items-end gap-1 overflow-x-auto" aria-label="CPU load per core">
    {pcts.map((p, i) => (
      <div key={i} className="flex w-5 shrink-0 flex-col items-center gap-0.5" title={`Core ${i}: ${Math.round(p)}%`}>
        <div className="flex h-16 w-full items-end rounded-sm bg-slate-700/50">
          <div className="w-full rounded-sm" style={{ height: `${Math.max(p, 3)}%`, background: levelColor(p) }} />
        </div>
        <span className="text-[9px] text-txt-muted">{i}</span>
      </div>
    ))}
  </div>
);

/** Big number with a small caption. */
export const StatTile: React.FC<{ label: string; value: string; testId?: string }> = ({ label, value, testId }) => (
  <div className="rounded-md bg-slate-700/30 px-3 py-2" data-testid={testId}>
    <div className="truncate text-sm font-semibold text-txt-primary" title={value}>
      {value}
    </div>
    <div className="text-[10px] uppercase tracking-wide text-txt-muted">{label}</div>
  </div>
);

/** Two bars (e.g. ↓/↑ or read/write) scaled against the recent peak so a quiet link doesn't look saturated. */
export const DualBars: React.FC<{
  a: { label: string; value: number | null; color: string };
  b: { label: string; value: number | null; color: string };
  peak: number;
}> = ({ a, b, peak }) => (
  <HBars
    rows={[a, b].map((x) => ({
      label: x.label,
      pct: x.value === null || peak <= 0 ? 0 : (100 * x.value) / peak,
      right: x.value === null ? '–' : `${formatBytes1(x.value)}/s`,
      color: x.color,
    }))}
  />
);
