import { useState } from "react";
import type { TokenKind } from "./parts";
import { CALC_N, EM, LENGTH, MS, SIZE, TIME, clampParts, colorSyntax, formatColor, parseColor, rangeFill, scaleNumbers, stepFor, toHex } from "./tokenValues";
import { tokenLabel, tokenNote } from "./tokenNames";
import { EasingControl, isEasing } from "./EasingControl";
import { FontControl } from "./FontControl";
import { PlayButton } from "./LayerExtras";
import { isFontValue, type FontFamily } from "./fonts";
import { valueProblem } from "./valueCheck";
import styles from "./Inspector.module.css";

// One design token: its name, the prompt line it comes from, and a control that fits its kind. Sizes are edited in
// design pixels (the N in calc(N * var(--u))), tracking in em, durations in ms; colours with a picker plus opacity.

type Props = {
  name: string;
  meta: { kind: TokenKind; role: string; label?: string } | undefined;
  saved: string;
  phone: string | undefined;
  site?: string; // set by the site's own code at startup, overriding the tokens file
  value: string;
  changed: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  scope?: string; // the layer this control changes, when it's a layer's own value rather than the site-wide token
  onFont?: (f: FontFamily) => void; // a Google font was picked: load it into the site (and into the page on Save)
  onPlay?: () => void; // a motion value: plays the animation on the page
  inert?: "overridden" | "unused"; // changing it moves nothing on the layer at this size (observe.ts asked the page)
};

function NumberControl(props: { n: number; step: number; min: number; max: number; unit: string; onChange: (n: number) => void }) {
  const { n, step, min, max, unit, onChange } = props;
  return (
    <div className={styles.number}>
      <input type="range" min={min} max={max} step={step} value={n} style={rangeFill(n, min, max)} onChange={(e) => onChange(+e.target.value)} />
      <input type="number" step={step} value={n} onChange={(e) => onChange(+e.target.value)} />
      <span>{unit}</span>
    </div>
  );
}

export function TokenControl({ name, meta, saved, phone, site, value, changed, onChange, onReset, scope, onFont, onPlay, inert }: Props) {
  const kind = meta?.kind ?? "text";
  const [more, setMore] = useState(false);
  let control: React.ReactNode = null;

  const v = value.trim();
  const size = v.match(SIZE);
  const em = v.match(EM);
  const ms = v.match(MS);
  const calcN = size ? null : v.match(CALC_N);
  const length = v.match(LENGTH);
  const time = v.match(TIME);
  const clamp = clampParts(v);
  const savedClamp = clampParts(saved) ? saved : null;
  // A colour by its value too: a token described as "text" that holds rgb(0 0 0 / 0.32) still gets a swatch
  const color = kind === "color" || kind === "text" ? parseColor(v) : null;

  if (isEasing(value)) {
    control = <EasingControl value={value} onChange={onChange} onPlay={onPlay} />;
  } else if (kind === "text" && isFontValue(value)) {
    control = (
      <FontControl
        value={value}
        onPick={(f, v) => {
          onFont?.(f);
          onChange(v);
        }}
      />
    );
  } else if (color) {
    control = (
      <div className={styles.color}>
        <input
          type="color"
          value={toHex(color)}
          onChange={(e) => {
            const c = parseColor(e.target.value);
            if (c) onChange(formatColor({ ...c, a: color.a }, colorSyntax(v)));
          }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={color.a}
          style={rangeFill(color.a, 0, 1)}
          onChange={(e) => onChange(formatColor({ ...color, a: +e.target.value }, colorSyntax(v)))}
          aria-label="Opacity"
        />
        <span>{Math.round(color.a * 100)}%</span>
      </div>
    );
  } else if (kind === "size" && size) {
    const n = +size[1];
    const savedN = +(saved.match(SIZE)?.[1] ?? n);
    control = (
      <NumberControl
        n={n}
        step={0.5}
        min={0}
        max={Math.max(savedN * 3, 10)}
        unit="px"
        onChange={(x) => onChange(`calc(${x} * var(--u))`)}
      />
    );
  } else if (calcN) {
    // calc(N * var(--a) * var(--b)): the N
    const n = +calcN[1];
    const unit = calcN[2] ?? "";
    control = <NumberControl n={n} step={stepFor(unit || "px", n)} min={Math.min(0, n * 2)} max={Math.max(Math.abs(n) * 3, 10)} unit={unit || "×"} onChange={(x) => onChange(`calc(${+x.toFixed(3)}${unit} * ${calcN[3]})`)} />;
  } else if (time && !ms) {
    // A time in seconds (0.45s): edited in seconds
    const n = +time[1];
    control = (
      <>
        <NumberControl n={n} step={0.05} min={0} max={Math.max(2, n * 3)} unit="s" onChange={(x) => onChange(`${+x.toFixed(3)}s`)} />
        {onPlay && <PlayButton onPlay={onPlay} />}
      </>
    );
  } else if (length && !(kind === "em" && em)) {
    // A plain length: 24px, 1.5rem, 60%: the number in its own unit
    const n = +length[1];
    const unit = length[2];
    const savedN = +(saved.trim().match(LENGTH)?.[1] ?? n);
    control = <NumberControl n={n} step={stepFor(unit, n)} min={Math.min(0, savedN * 2)} max={Math.max(Math.abs(savedN) * 3, unit === "px" ? 40 : 4)} unit={unit} onChange={(x) => onChange(`${+x.toFixed(3)}${unit}`)} />;
  } else if (clamp && savedClamp) {
    // clamp(min, preferred, max): scaled as a whole, so the size keeps growing with the screen the same way
    const first = (s: string) => +(s.match(/-?\d*\.?\d+/)?.[0] ?? 1);
    const f = first(clamp[0]) / (first(clampParts(savedClamp)?.[0] ?? clamp[0]) || 1);
    control = <NumberControl n={+f.toFixed(2)} step={0.05} min={0.5} max={2} unit="×" onChange={(x) => onChange(scaleNumbers(savedClamp, x))} />;
  } else if (kind === "em" && em) {
    control = <NumberControl n={+em[1]} step={0.01} min={-0.2} max={0.5} unit="em" onChange={(x) => onChange(`${+x.toFixed(3)}em`)} />;
  } else if (kind === "number" && /^-?[\d.]+$/.test(value.trim())) {
    const n = +value.trim();
    control = <NumberControl n={n} step={n % 1 || Math.abs(n) < 2 ? 0.01 : 1} min={Math.min(0, n * 2)} max={Math.max(1, n * 3)} unit="" onChange={(x) => onChange(String(+x.toFixed(3)))} />;
  } else if (kind === "ms" && ms) {
    control = (
      <>
        <NumberControl n={+ms[1]} step={10} min={0} max={Math.max(1000, +ms[1] * 3)} unit="ms" onChange={(x) => onChange(`${x}ms`)} />
        {onPlay && <PlayButton onPlay={onPlay} />}
      </>
    );
  }

  // A colour shows its hex next to the picker, and a value with no slider (a font) is typed as it is; everything a
  // designer doesn't need to see (the code name, the CSS behind a size, the phone value) waits behind Show more
  // A typed value that can't be saved (not a colour where a colour was, an unclosed bracket): the field says so here,
  // and Save refuses it (Editor.tsx save; the dev server checks again)
  const problem = changed ? valueProblem(value, saved) : null;
  const rawFirst = !control || !!color || !!clamp || !!problem;
  const note = tokenNote(meta, name);
  return (
    <div className={styles.token} data-changed={changed} data-invalid={problem ? "true" : undefined}>
      <div className={styles.tokenHead}>
        {(kind === "color" || color) && <i className={styles.swatch} data-empty={problem ? "true" : undefined} style={problem ? undefined : { background: value }} />}
        <strong className={styles.tokenName}>{tokenLabel(name, meta)}</strong>
        {changed && (
          <button type="button" className={styles.link} onClick={onReset}>
            reset
          </button>
        )}
      </div>
      {control}
      {rawFirst && <input className={styles.raw} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label={`${tokenLabel(name, meta)} value`} aria-invalid={problem ? true : undefined} />}
      {problem && (
        <p className={styles.invalid} role="alert">
          Can't be saved like this: {problem}.
        </p>
      )}
      {inert && !problem && (
        <p className={styles.phone}>
          {inert === "overridden"
            ? `A rule ${scope ? `of ${scope} ` : ""}uses this value, but changing it moves nothing at this size: a later rule sets the same thing.`
            : `No rule ${scope ? `on ${scope} or inside it ` : ""}uses this value, so changing it here shows nothing (unless a script reads it).`}
        </p>
      )}
      {site !== undefined && (
        <p className={styles.phone}>The site's code sets this at startup ({site}), over the tokens file: try values here, then ask Claude to change it where the code sets it.</p>
      )}
      <button type="button" className={styles.more} aria-expanded={more} onClick={() => setMore((m) => !m)}>
        {more ? "Show less" : "Show more"}
      </button>
      {more && (
        <div className={styles.moreBox}>
          <p className={styles.role}>
            <code>{name}</code>
            {note && <span> · {note}</span>}
          </p>
          {!rawFirst && <input className={styles.raw} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label={`${name} value`} />}
          {scope && <p className={styles.phone}>Changes here apply to {scope} only. Save writes them for this layer, and the rest of the site keeps the site-wide value.</p>}
          {phone && <p className={styles.phone}>On phones: {phone} (edits here change desktop; phones keep this value)</p>}
        </div>
      )}
    </div>
  );
}
