/**
 * Dashboard visuals drawn as React SVG: metric cards with sparklines, the
 * attendance line chart (with a hover tooltip), the performance donut, the
 * quote card and the lotus decoration. Colours come from tokens; every chart
 * carries a text summary for screen readers.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './primitives';

/** The Holy Sai lotus as a faint decoration (hidden from assistive technology). */
export { LotusMark } from './LotusArt';
import { LotusMark } from './LotusArt';

/* ---- Sparkline ------------------------------------------------------------- */
/** Smooth path through the points (Catmull-Rom converted to cubic Béziers). */
function smooth(pts: readonly (readonly [number, number])[]) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Trend line: smooth curve, soft gradient fill, faint baseline and a ringed dot on the latest value. */
export function Sparkline({ values, color, className }: { values: number[]; color: string; className?: string }) {
  const id = useId().replace(/:/g, '');
  if (values.length < 2) return null;
  const W = 140, H = 56, padX = 5, padTop = 7, padBottom = 5;
  const max = Math.max(...values), min = Math.min(...values), rng = max - min || 1;
  const pts = values.map((v, i) => [padX + (i / (values.length - 1)) * (W - padX * 2), padTop + (1 - (v - min) / rng) * (H - padTop - padBottom)] as const);
  const line = smooth(pts);
  const end = pts[pts.length - 1];
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={padX} x2={W - padX} y1={H - 1} y2={H - 1} stroke="var(--border)" strokeDasharray="2 3" />
      <path d={`${line} L${end[0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`} fill={`url(#sp${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end[0]} cy={end[1]} r="5.5" fill={color} opacity=".18" />
      <circle cx={end[0]} cy={end[1]} r="3" fill="var(--surface)" stroke={color} strokeWidth="2" />
    </svg>
  );
}

/* ---- Metric card ----------------------------------------------------------- */
export type MetricTone = 'rose' | 'blue' | 'green' | 'amber';
/** Four distinct tones: red, violet, teal and gold. */
const SPARK: Record<MetricTone, string> = { rose: '#D32F2F', blue: '#6D4AB8', green: '#12867F', amber: '#D4A017' };

/** Small monthly bars; the latest bar is solid, earlier ones lighter. */
export function MiniBars({ values, labels, color, className }: { values: number[]; labels?: string[]; color: string; className?: string }) {
  if (!values.length) return null;
  const W = 140, H = 56, gap = 6, base = H - 12;
  const max = Math.max(...values), min = Math.min(...values) * 0.85;
  const bw = (W - gap * (values.length - 1)) / values.length;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(4, ((v - min) / (max - min || 1)) * (base - 6) + 6);
        const last = i === values.length - 1;
        return (
          <g key={i}>
            <rect x={i * (bw + gap)} y={base - h} width={bw} height={h} rx="3" fill={color} opacity={last ? 1 : 0.28} />
            {labels?.[i] && (i === 0 || last) && <text x={i * (bw + gap) + bw / 2} y={H - 1} textAnchor="middle" fontSize="8.5" fill="var(--text-muted)">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** A ring filled to a percentage. */
export function MiniRing({ pct, color, className }: { pct: number; color: string; className?: string }) {
  const R = 22, C = 2 * Math.PI * R, p = Math.max(0, Math.min(100, pct));
  return (
    <svg className={className} viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeOpacity=".14" strokeWidth="6" />
      <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${(p / 100) * C} ${C}`} transform="rotate(-90 28 28)" />
      <text x="28" y="31.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text-strong)">{Math.round(p)}%</text>
    </svg>
  );
}

/** Segmented progress toward a total, with the month-end steps marked under it. */
export function MiniProgress({ pct, steps, color, className }: { pct: number; steps?: number[]; color: string; className?: string }) {
  const SEG = 10, p = Math.max(0, Math.min(100, pct));
  return (
    <span className={`miniprogress${className ? ` ${className}` : ''}`} aria-hidden="true" style={{ ['--mp' as string]: color }}>
      <span className="miniprogress__bar">
        {Array.from({ length: SEG }, (_, i) => {
          const fill = Math.max(0, Math.min(1, (p - i * (100 / SEG)) / (100 / SEG)));
          return <i key={i}><b style={{ width: `${fill * 100}%` }} /></i>;
        })}
      </span>
      {steps && steps.length > 1 && (
        <span className="miniprogress__steps">
          {steps.map((v, i) => <em key={i} style={{ left: `${Math.max(0, Math.min(100, v))}%` }} />)}
        </span>
      )}
      <span className="miniprogress__scale"><span>0%</span><span>Target 100%</span></span>
    </span>
  );
}

export type MetricViz = 'line' | 'bars' | 'ring' | 'progress';

/** Headline figure: icon tile, label, figure and change on the left; a visual suited to the figure on the right. */
export function MetricCard({ icon, tone, label, value, delta, deltaUnit = '%', compare, spark, sparkLabels, pct, viz = 'line', to }: {
  icon: string; tone: MetricTone; label: string; value: ReactNode;
  /** Change against the comparison period; null hides it. */
  delta?: number | null; deltaUnit?: string; compare?: string; spark?: number[]; sparkLabels?: string[];
  /** Percentage for the ring and progress visuals. */
  pct?: number | null; viz?: MetricViz; to?: string;
}) {
  const up = (delta ?? 0) >= 0;
  const body = (
    <>
      <span className="metric__tile"><Icon name={icon} size={18} /></span>
      <div className="metric__body">
        <div className="metric__label">{label}</div>
        <div className="metric__value">{value}</div>
        {delta != null && (
          <div className={`metric__delta${up ? '' : ' metric__delta--down'}`}>
            <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} />
            <span><span className="sr-only">{up ? 'up' : 'down'} </span>{Math.abs(delta)}{deltaUnit}</span>
          </div>
        )}
        {compare && <span className="metric__cmp">{compare}</span>}
      </div>
      {viz === 'line' && spark && spark.length > 1 && <Sparkline className="metric__spark" values={spark} color={SPARK[tone]} />}
      {viz === 'bars' && spark && spark.length > 1 && <MiniBars className="metric__spark" values={spark} labels={sparkLabels} color={SPARK[tone]} />}
      {viz === 'ring' && pct != null && <MiniRing className="metric__ring" pct={pct} color={SPARK[tone]} />}
      {viz === 'progress' && pct != null && <MiniProgress className="metric__progress" pct={pct} steps={spark} color={SPARK[tone]} />}
    </>
  );
  return to
    ? <Link className="metric" data-tone={tone} data-viz={viz} to={to}>{body}</Link>
    : <div className="metric" data-tone={tone} data-viz={viz}>{body}</div>;
}

/* ---- Line chart -------------------------------------------------------------- */
export interface LineSeries { name: string; values: (number | null)[]; color: string; area?: boolean }

/**
 * Percentage line chart with a light grid, small dots, a pale fill under the
 * first series and a tooltip that follows the pointer (the latest point by default).
 */
export function LineChart({ labels, tips, series, yMin, yMax = 100, unit = '%', height = 200, label }: {
  labels: string[]; tips?: string[]; series: LineSeries[]; yMin?: number; yMax?: number; unit?: string; height?: number; label: string;
}) {
  const gid = useId().replace(/:/g, '');
  const n = labels.length;
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  // Four even steps down from the top, the smallest step that leaves room under the lowest point.
  const tickStep = [2.5, 5, 7.5, 10, 12.5, 15, 20, 25].find((st) => yMax - 4 * st <= Math.min(...all) - 3) ?? 25;
  const lo = yMin ?? Math.max(0, yMax - 4 * tickStep);
  const W = 680, H = height, P = { t: 14, r: 14, b: 26, l: 44 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const X = (i: number) => P.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v: number) => P.t + ih - ((v - lo) / (yMax - lo)) * ih;
  const ticks = [0, 1, 2, 3, 4].map((g) => yMax - (g / 4) * (yMax - lo));
  const step = n > 8 ? Math.ceil(n / 8) : 1;
  const active = hover ?? n - 1;
  const main = series[0];
  const tipValue = main?.values[active];

  const paths = useMemo(() => series.map((s) => {
    const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return { s, pts, d };
  }), [series, n, lo, yMax, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtTick = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
  const summary = `${label}. ${series.map((s) => `${s.name}: ${s.values.map((v, i) => (v == null ? null : `${labels[i]} ${v}${unit}`)).filter(Boolean).join(', ')}`).join('. ')}`;

  return (
    <div className="linechart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((x - P.l) / iw) * (n - 1)))));
        }}>
        <defs>
          <linearGradient id={`lc${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={main?.color} stopOpacity=".08" />
            <stop offset="1" stopColor={main?.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={Y(t)} y2={Y(t)} stroke="var(--viz-grid)" strokeDasharray="3 4" />
            <text x={P.l - 10} y={Y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-muted)">{fmtTick(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % step === 0 || i === n - 1) && (
          <text key={i} x={X(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{l}</text>
        ))}
        {paths[0] && paths[0].pts.length > 1 && main.area !== false && (
          <path d={`${paths[0].d} L${paths[0].pts[paths[0].pts.length - 1][0]} ${P.t + ih} L${paths[0].pts[0][0]} ${P.t + ih} Z`} fill={`url(#lc${gid})`} />
        )}
        {paths.slice().reverse().map(({ s, d, pts }) => (
          <g key={s.name}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={s === main ? 1.6 : 1.2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {tipValue != null && <line x1={X(active)} x2={X(active)} y1={P.t} y2={P.t + ih} stroke="var(--border)" />}
        {tipValue != null && <circle cx={X(active)} cy={Y(tipValue)} r="4" fill={main.color} stroke="var(--surface)" strokeWidth="2" />}
      </svg>
      {tipValue != null && (
        <div className={`linechart__tip${X(active) > W * 0.86 ? ' linechart__tip--end' : X(active) < W * 0.14 ? ' linechart__tip--start' : ''}`} style={{ left: `${(X(active) / W) * 100}%`, top: `${(Y(tipValue) / H) * 100}%` }} aria-hidden="true">
          <small>{tips?.[active] ?? labels[active]}</small>
          <strong>{tipValue}{unit}</strong>
        </div>
      )}
    </div>
  );
}

/* ---- Donut ------------------------------------------------------------------- */
export interface DonutBand { label: string; value: number; color: string; to?: string }

export function Donut({ bands, center, centerSub, label }: { bands: DonutBand[]; center: string; centerSub?: string; label: string }) {
  const total = bands.reduce((s, b) => s + b.value, 0) || 1;
  const R = 72, T = 12, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={`${label}: ${bands.map((b) => `${b.label} ${Math.round((b.value / total) * 100)}%`).join(', ')}`}>
        <g transform="rotate(-90 80 80)">
          {bands.map((b) => {
            const len = (b.value / total) * C;
            const gap = bands.filter((x) => x.value > 0).length > 1 ? 2 : 0;
            const el = <circle key={b.label} cx="80" cy="80" r={R} fill="none" stroke={b.color} strokeWidth={T}
              strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-acc} />;
            acc += len;
            return el;
          })}
        </g>
      </svg>
      <div className="donut__center" aria-hidden="true"><strong>{center}</strong>{centerSub && <span>{centerSub}</span>}</div>
    </div>
  );
}

/* ---- Quote card -------------------------------------------------------------- */
export function QuoteCard({ quote = 'Education builds character, shapes the future.', by = 'Holy Sai International' }: { quote?: string; by?: string }) {
  return (
    <figure className="quotecard">
      <blockquote className="quotecard__text">{quote}</blockquote>
      <figcaption className="quotecard__by">{by}</figcaption>
      <LotusMark className="quotecard__lotus" />
    </figure>
  );
}
