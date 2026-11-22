import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlayButton } from "./LayerExtras";
import styles from "./Inspector.module.css";

// An easing token as a curve: pick a preset, or drag the two handles of the cubic-bézier on the graph (as in a motion
// tool's graph editor). The dot below replays a move with the curve. Values stay CSS: a keyword for CSS's own easings,
// cubic-bezier(x1, y1, x2, y2) for everything else.

type Curve = [number, number, number, number];

// CSS's own keywords, then the usual named curves (as easings.net lists them)
const PRESETS: { label: string; curve: Curve; keyword?: string }[] = [
  { label: "Linear", curve: [0, 0, 1, 1], keyword: "linear" },
  { label: "Ease", curve: [0.25, 0.1, 0.25, 1], keyword: "ease" },
  { label: "Ease in", curve: [0.42, 0, 1, 1], keyword: "ease-in" },
  { label: "Ease out", curve: [0, 0, 0.58, 1], keyword: "ease-out" },
  { label: "Ease in-out", curve: [0.42, 0, 0.58, 1], keyword: "ease-in-out" },
  { label: "Sine in", curve: [0.12, 0, 0.39, 0] },
  { label: "Sine out", curve: [0.61, 1, 0.88, 1] },
  { label: "Sine in-out", curve: [0.37, 0, 0.63, 1] },
  { label: "Quad in", curve: [0.11, 0, 0.5, 0] },
  { label: "Quad out", curve: [0.5, 1, 0.89, 1] },
  { label: "Quad in-out", curve: [0.45, 0, 0.55, 1] },
  { label: "Cubic in", curve: [0.32, 0, 0.67, 0] },
  { label: "Cubic out", curve: [0.33, 1, 0.68, 1] },
  { label: "Cubic in-out", curve: [0.65, 0, 0.35, 1] },
  { label: "Quart in", curve: [0.5, 0, 0.75, 0] },
  { label: "Quart out", curve: [0.25, 1, 0.5, 1] },
  { label: "Quart in-out", curve: [0.76, 0, 0.24, 1] },
  { label: "Quint in", curve: [0.64, 0, 0.78, 0] },
  { label: "Quint out", curve: [0.22, 1, 0.36, 1] },
  { label: "Quint in-out", curve: [0.83, 0, 0.17, 1] },
  { label: "Expo in", curve: [0.7, 0, 0.84, 0] },
  { label: "Expo out", curve: [0.16, 1, 0.3, 1] },
  { label: "Expo in-out", curve: [0.87, 0, 0.13, 1] },
  { label: "Circ in", curve: [0.55, 0, 1, 0.45] },
  { label: "Circ out", curve: [0, 0.55, 0.45, 1] },
  { label: "Circ in-out", curve: [0.85, 0, 0.15, 1] },
  { label: "Back in", curve: [0.36, 0, 0.66, -0.56] },
  { label: "Back out", curve: [0.34, 1.56, 0.64, 1] },
  { label: "Back in-out", curve: [0.68, -0.6, 0.32, 1.6] },
];

const KEYWORDS = new Map(PRESETS.filter((p) => p.keyword).map((p) => [p.keyword as string, p.curve]));
const BEZIER = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;

export function parseEasing(value: string): Curve | null {
  const v = value.trim();
  const k = KEYWORDS.get(v);
  if (k) return k;
  const m = v.match(BEZIER);
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
}
export const isEasing = (value: string) => parseEasing(value) !== null;

const round = (n: number) => Math.round(n * 100) / 100;
const same = (a: Curve, b: Curve) => a.every((x, i) => Math.abs(x - b[i]) < 0.005);
function format(c: Curve): string {
  const preset = PRESETS.find((p) => p.keyword && same(p.curve, c));
  return preset?.keyword ?? `cubic-bezier(${c.map(round).join(", ")})`;
}

// The graph: time across, progress up. Room above and below the square for curves that overshoot (Back).
const W = 220;
const PAD = 20;
const SIZE = W - PAD * 2;
const TOP = 46; // overshoot room
const H = SIZE + TOP * 2;
const toX = (x: number) => PAD + x * SIZE;
const toY = (y: number) => TOP + (1 - y) * SIZE;
const PREVIEW_MS = 1100;

export function EasingControl({ value, onChange, onPlay }: { value: string; onChange: (v: string) => void; onPlay?: () => void }) {
  const curve = parseEasing(value) ?? [0.25, 0.1, 0.25, 1];
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const [run, setRun] = useState(0); // bumps to replay the preview
  const preset = PRESETS.find((p) => same(p.curve, curve));

  useEffect(() => setRun((r) => r + 1), [value]);

  const move = (ev: ReactPointerEvent) => {
    if (drag === null || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, ((ev.clientX - r.left) / r.width * W - PAD) / SIZE));
    const y = Math.min(2, Math.max(-1, 1 - ((ev.clientY - r.top) / r.height * H - TOP) / SIZE));
    const next: Curve = [...curve];
    next[drag * 2] = round(x);
    next[drag * 2 + 1] = round(y);
    onChange(format(next));
  };
  const setAt = (i: number, n: number) => {
    if (!Number.isFinite(n)) return;
    const next: Curve = [...curve];
    next[i] = i % 2 === 0 ? Math.min(1, Math.max(0, n)) : n;
    onChange(format(next));
  };

  const [x1, y1, x2, y2] = curve;
  const path = `M${toX(0)},${toY(0)} C${toX(x1)},${toY(y1)} ${toX(x2)},${toY(y2)} ${toX(1)},${toY(1)}`;
  return (
    <div className={styles.easing}>
      <select value={preset?.label ?? "custom"} onChange={(e) => onChange(format(PRESETS.find((p) => p.label === e.target.value)?.curve ?? curve))} aria-label="Easing preset">
        {!preset && <option value="custom">Custom curve</option>}
        {PRESETS.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
          </option>
        ))}
      </select>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className={styles.graph}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        role="img"
        aria-label={`Easing curve ${format(curve)}`}
      >
        <rect x={PAD} y={TOP} width={SIZE} height={SIZE} className={styles.graphBox} />
        <path d={`M${toX(0)},${toY(0)} L${toX(1)},${toY(1)}`} className={styles.graphDiagonal} />
        <path d={`M${toX(0)},${toY(0)} L${toX(x1)},${toY(y1)} M${toX(1)},${toY(1)} L${toX(x2)},${toY(y2)}`} className={styles.graphArm} />
        <path d={path} className={styles.graphCurve} />
        {[0, 1].map((i) => (
          <circle
            key={i}
            cx={toX(curve[i * 2])}
            cy={toY(curve[i * 2 + 1])}
            r={6}
            className={styles.graphHandle}
            data-dragging={drag === i}
            onPointerDown={(ev) => {
              (ev.currentTarget.ownerSVGElement ?? ev.currentTarget).setPointerCapture?.(ev.pointerId);
              setDrag(i as 0 | 1);
            }}
          />
        ))}
      </svg>
      <div className={styles.bezier}>
        {curve.map((n, i) => (
          <input key={i} type="number" step={0.01} value={n} onChange={(e) => setAt(i, +e.target.value)} aria-label={["x1", "y1", "x2", "y2"][i]} />
        ))}
      </div>
      <div className={styles.easingRow}>
        <button type="button" className={styles.easingPreview} onClick={() => setRun((r) => r + 1)} title="Replay the curve">
          <i key={run} style={{ animationTimingFunction: format(curve), animationDuration: `${PREVIEW_MS}ms` }} />
        </button>
        {onPlay && <PlayButton onPlay={onPlay} />}
      </div>
    </div>
  );
}
