/**
 * The Holy Sai lotus as vector artwork, drawn in the style of the official logo:
 * magenta petals shaded light to deep, gold-edged, over three flowing water lines.
 * Used for the decorations across the application (always hidden from screen readers).
 */
import { useId } from 'react';

/** One petal pointing up from the base (100, 112), `h` tall and `w` wide. */
const petal = (h: number, w: number) =>
  `M100 112 C ${100 - w} ${112 - h * 0.45}, ${100 - w * 0.55} ${112 - h * 0.85}, 100 ${112 - h} C ${100 + w * 0.55} ${112 - h * 0.85}, ${100 + w} ${112 - h * 0.45}, 100 112 Z`;

/** Petals from the back to the front: [rotation in degrees, height, half-width]. */
const PETALS: [number, number, number][] = [
  [-80, 74, 26], [80, 74, 26],
  [-56, 84, 20], [56, 84, 20],
  [-29, 92, 19], [29, 92, 19],
  [0, 102, 19],
];

export function LotusArt({ className, waves = true, title }: { className?: string; waves?: boolean; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} viewBox="0 0 200 150" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`lp${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F2558A" />
          <stop offset=".45" stopColor="#D11A5B" />
          <stop offset="1" stopColor="#8E0634" />
        </linearGradient>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE08A" />
          <stop offset="1" stopColor="#D99A1E" />
        </linearGradient>
        <linearGradient id={`lw${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#C2124F" stopOpacity="0" />
          <stop offset=".5" stopColor="#C2124F" />
          <stop offset="1" stopColor="#C2124F" stopOpacity=".2" />
        </linearGradient>
      </defs>
      {PETALS.map(([rot, h, w]) => (
        <g key={rot + ':' + h} transform={`rotate(${rot} 100 112)`}>
          <path d={petal(h, w)} fill={`url(#lp${id})`} stroke={`url(#lg${id})`} strokeWidth="1.8" strokeLinejoin="round" />
          {/* soft centre crease, as on the logo's petals */}
          <path d={`M100 ${112 - h * 0.12} Q ${100 - w * 0.12} ${112 - h * 0.55}, 100 ${112 - h * 0.93}`} fill="none" stroke="#FFFFFF" strokeOpacity=".28" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      ))}
      {waves && (
        <g fill="none" stroke={`url(#lw${id})`} strokeLinecap="round">
          <path d="M72 122 C 88 114, 104 116, 116 124" strokeWidth="3.2" />
          <path d="M84 131 C 102 122, 122 124, 138 134" strokeWidth="3.6" />
          <path d="M60 138 C 80 128, 104 130, 120 141" strokeWidth="3.2" />
        </g>
      )}
    </svg>
  );
}

/** Decorative lotus placed by its class name (position and opacity come from the stylesheet). */
export function LotusMark({ className, waves }: { className?: string; waves?: boolean }) {
  return <span className={className} aria-hidden="true"><LotusArt waves={waves} /></span>;
}

/** Brand divider from the logo: a line, a small lotus, a line. */
export function LotusDivider({ className }: { className?: string }) {
  return (
    <span className={`lotusdivider${className ? ` ${className}` : ''}`} aria-hidden="true">
      <i /><LotusArt waves={false} /><i />
    </span>
  );
}
