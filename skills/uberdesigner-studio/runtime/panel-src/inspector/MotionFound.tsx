import { api } from "./api";
import { useEffect, useState } from "react";
import type { Part } from "./parts";
import type { Settings } from "./change";
import { rulesOf } from "./inherited";
import { rangeFill } from "./tokenValues";
import { PlayButton } from "./LayerExtras";
import { elementOf, ownedBy } from "./resolve";
import { tellDirect, type DirectOut, type Say } from "./directEdit";
import { demangle, sourceOf as sheetSource } from "./pageRules";
import styles from "./Inspector.module.css";

// Motion written as plain CSS on a layer: its transitions and keyframe animations, read from the page (the layer's
// element and its own children, not nested layers), each with the rule it comes from. Durations and delays are edited
// live in that rule, and letting go writes them into the site's file (/__inspector/motion): a card with Undo.

type Kind = "transition" | "animation";
type Found = { key: string; kind: Kind; rule: CSSStyleRule; source: string; selector: string; media: string; names: string[]; durations: number[]; delays: number[] };

const seconds = (v: string) => (v.trim().endsWith("ms") ? parseFloat(v) / 1000 : parseFloat(v) || 0);
const list = (v: string) => splitTop(v).map((x) => x.trim()).filter(Boolean);
// Split at top-level commas (not the ones inside cubic-bezier(…) or var(…))
function splitTop(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of v) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}
const TIME = /^-?\d*\.?\d+m?s$/;
// The parts of a shorthand the browser can't split when it holds a var() (transform 0.45s var(--ease-pop)): per item,
// its name and its first and second time (duration, delay)
function readShorthand(kind: Kind, v: string): { names: string[]; durations: number[]; delays: number[]; literal: boolean[] } {
  const items = list(v).map((item) => item.replace(/\([^()]*\)/g, (m) => m.replace(/\s+/g, "")).split(/\s+/));
  const isName = (t: string) => !TIME.test(t) && !/^(var|cubic-bezier|steps)\(/.test(t) && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|infinite|alternate|alternate-reverse|reverse|normal|forwards|backwards|both|none|running|paused|\d+)$/.test(t);
  return {
    names: items.map((ts) => ts.find(isName) ?? (kind === "transition" ? "all" : "")),
    durations: items.map((ts) => seconds(ts.filter((t) => TIME.test(t))[0] ?? "0s")),
    delays: items.map((ts) => seconds(ts.filter((t) => TIME.test(t))[1] ?? "0s")),
    literal: items.map((ts) => ts.some((t) => TIME.test(t))),
  };
}
const fmt = (n: number) => `${+n.toFixed(3)}s`;

const sourceOf = (rule: CSSStyleRule, doc: Document) => sheetSource(rule.parentStyleSheet, doc);
const mediaOf = (rule: CSSStyleRule) => {
  const parent = rule.parentRule as (CSSRule & { conditionText?: string }) | null;
  return parent?.conditionText ?? "";
};
const matches = (el: Element, selector: string) => {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
};

export function findMotion(el: Element, doc: Document): Found[] {
  const win = doc.defaultView;
  if (!win) return [];
  const rules = rulesOf(doc);
  const own = [el, ...Array.from(el.querySelectorAll("*")).filter((x) => ownedBy(el, x))].slice(0, 80);
  const out = new Map<string, Found>();
  for (const x of own) {
    const cs = win.getComputedStyle(x);
    for (const kind of ["transition", "animation"] as Kind[]) {
      if (kind === "animation" && cs.animationName === "none") continue;
      if (list(cs.getPropertyValue(`${kind}-duration`)).every((d) => seconds(d) === 0)) continue;
      // The rule that sets it: the last one (in page order) that matches and applies at this size
      const rule = [...rules].reverse().find((r) => (r.style.getPropertyValue(`${kind}-duration`) || r.style.getPropertyValue(kind)) && matches(x, r.selectorText) && (!mediaOf(r) || win.matchMedia(mediaOf(r)).matches));
      if (!rule) continue;
      const source = sourceOf(rule, doc);
      if (!source || /\/__inspector\//.test(source)) continue;
      const key = `${source}|${mediaOf(rule)}|${rule.selectorText}|${kind}`;
      if (out.has(key)) continue;
      // The longhands when the browser has them, else read from the shorthand as written
      const long = rule.style.getPropertyValue(`${kind}-duration`);
      const short = readShorthand(kind, rule.style.getPropertyValue(kind));
      // A duration written as a token (var(--dur-fast)) is the token's to change: it shows with the layer's tokens
      if (!long && short.literal.some((has) => !has)) continue;
      out.set(key, {
        key,
        kind,
        rule,
        source,
        selector: /\.module\.css$/.test(source.split("?")[0]) ? demangle(rule.selectorText) : rule.selectorText,
        media: mediaOf(rule),
        names: (long ? list(rule.style.getPropertyValue(kind === "transition" ? "transition-property" : "animation-name")) : short.names).map(demangle),
        durations: long ? list(long).map(seconds) : short.durations,
        delays: long ? list(rule.style.getPropertyValue(`${kind}-delay`) || "0s").map(seconds) : short.delays,
      });
    }
  }
  return [...out.values()];
}

type Props = { part: Part; doc: Document | null; seen: string; version: number; settings: Settings; blocked: string | null; onStatus: Say; onDone: () => void; onPlay: () => void };

export function MotionFound({ part, doc, seen, version, settings, blocked, onStatus, onDone, onPlay }: Props) {
  const [found, setFound] = useState<Found[]>([]);
  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    const el = elementOf(doc, part.id);
    setFound(el && doc ? findMotion(el, doc) : []);
    setDraft({});
  }, [part.id, doc, seen, version]);
  if (!found.length) return null;

  // Live: the rule itself changes on the page; letting go writes the whole list into the site's file
  const values = (f: Found, what: "duration" | "delay") => (what === "duration" ? f.durations : f.delays).map((n, i) => draft[`${f.key}|${what}|${i}`] ?? n);
  const set = (f: Found, what: "duration" | "delay", i: number, n: number) => {
    setDraft((d) => ({ ...d, [`${f.key}|${what}|${i}`]: n }));
    const next = values(f, what).map((x, k) => (k === i ? n : x));
    f.rule.style.setProperty(`${f.kind}-${what}`, next.map(fmt).join(", "));
  };
  const commit = async (f: Found, what: "duration" | "delay", asked?: number[]) => {
    const next = asked ?? values(f, what);
    const before = what === "duration" ? f.durations : f.delays;
    if (!asked && next.every((n, i) => n === before[i])) return;
    if (blocked) return onStatus(blocked);
    onStatus(`Setting the ${f.kind} ${what}…`);
    try {
      const res = await api("/__inspector/motion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId: part.id, source: f.source, selector: f.selector, media: f.media, prop: `${f.kind}-${what}`, value: next.map(fmt).join(", "), model: settings.model, effort: "low", claude: !!asked }),
      });
      const out = (await res.json()) as DirectOut;
      if (!out.ok) throw new Error(out.error ?? "Couldn't set it");
      if (asked && !out.direct) {
        onStatus(`Sent to Claude: ${out.why ?? "it couldn't be done directly"}`);
        return onDone();
      }
      if (!out.direct) {
        // Not written: the rule on the page and the sliders go back to what the file has
        f.rule.style.setProperty(`${f.kind}-${what}`, before.map(fmt).join(", "));
        setDraft({});
      }
      tellDirect(out, `The ${f.kind} ${what} is set in the file`, onStatus, () => void commit(f, what, next), onDone);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Couldn't set it");
    }
  };

  const row = (f: Found, what: "duration" | "delay", i: number, n: number) => (
    <div key={`${what}${i}`} className={styles.token}>
      <div className={styles.tokenHead}>
        <strong className={styles.tokenName}>
          {what === "duration" ? "Duration" : "Delay"}
          {f.names.length > 1 ? ` · ${f.names[i] ?? f.names[0]}` : ""}
        </strong>
      </div>
      <div className={styles.number}>
        <input type="range" min={0} max={Math.max(2, n * 3)} step={0.05} value={n} style={rangeFill(n, 0, Math.max(2, n * 3))} onChange={(e) => set(f, what, i, +e.target.value)} onPointerUp={() => void commit(f, what)} onKeyUp={() => void commit(f, what)} />
        <input type="number" step={0.05} value={+n.toFixed(3)} onChange={(e) => set(f, what, i, +e.target.value)} onBlur={() => void commit(f, what)} onKeyDown={(e) => e.key === "Enter" && void commit(f, what)} />
        <span>s</span>
      </div>
    </div>
  );

  return (
    <>
      <h3 className={styles.withPlay}>
        Motion in the CSS <PlayButton onPlay={onPlay} />
      </h3>
      {found.map((f) => (
        <div key={f.key}>
          <p className={styles.role}>
            {f.kind === "transition" ? "Transition" : "Animation"}
            {f.names.length ? `: ${f.names.join(", ")}` : ""} · <code>{f.selector}</code>
            {f.media ? ` (${f.media})` : ""}
          </p>
          {values(f, "duration").map((n, i) => row(f, "duration", i, n))}
          {values(f, "delay").map((n, i) => (n > 0 || f.delays.some((d) => d > 0) ? row(f, "delay", i, n) : null))}
        </div>
      ))}
    </>
  );
}
