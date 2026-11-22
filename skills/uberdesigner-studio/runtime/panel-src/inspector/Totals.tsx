import { api } from "./api";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { k } from "./jobs";
import styles from "./Inspector.module.css";

// The top-right corner of the editor: tokens saved by uberdesigner, added up across every site and chat on this
// computer (the dev server keeps them in ~/.uberdesigner/design-map/totals.json, server/savings.ts). It reads them
// again when a change finishes, when the window comes back into focus, and every half minute, since another site's
// editor or chat may have added to them. Clicking it shows what's counted and how.
//
// Milestones, like a streak or a rating: the badge takes the colour of the highest one reached, with a bar to the next.
// A new saving counts up and floats its "+50k" above the badge; passing a milestone pops the badge, throws sparks and
// says so for a moment (once per milestone per browser). Motion is left out for people who ask for less.

type Count = { used: number; saved: number; changes: number };
type View = { all: Count; site: Count | null; since: string; backtest: { date: string; cases: number; claudeCode: number; inspector: number } };
const POLL_MS = 30_000;

type Tier = { at: number; name: string; from: string; to: string; glow: string; shine?: boolean };
// The fills are the art director's (files/Tokens-Saved.md, 18 Nov 2026): one flat colour per milestone, white words
// on each. 1B is ours (he stops at 500M): near-black. An upcoming milestone's swatch in the list is UPCOMING.
export const TIERS: Tier[] = [
  { at: 0, name: "Getting started", from: "#555160", to: "#555160", glow: "transparent" }, // neutral graphite
  { at: 100_000, name: "100k saved", from: "#17784E", to: "#17784E", glow: "rgba(23, 120, 78, 0.28)" }, // studio green
  { at: 1_000_000, name: "1M saved", from: "#365DAC", to: "#365DAC", glow: "rgba(54, 93, 172, 0.28)" }, // cobalt
  { at: 10_000_000, name: "10M saved", from: "#6B3FE0", to: "#6B3FE0", glow: "rgba(107, 63, 224, 0.3)", shine: true }, // studio violet
  { at: 50_000_000, name: "50M saved", from: "#975015", to: "#975015", glow: "rgba(151, 80, 21, 0.3)", shine: true }, // amber
  { at: 100_000_000, name: "100M saved", from: "#A33577", to: "#A33577", glow: "rgba(163, 53, 119, 0.3)", shine: true }, // berry
  { at: 500_000_000, name: "500M saved", from: "#493178", to: "#493178", glow: "rgba(73, 49, 120, 0.32)", shine: true }, // deep plum
  { at: 1_000_000_000, name: "1B saved", from: "#16141C", to: "#16141C", glow: "rgba(255, 255, 255, 0.14)", shine: true }, // near-black
];
export const UPCOMING = "#77737E";
const tierOf = (n: number) => TIERS.reduce((t, x, i) => (n >= x.at ? i : t), 0);

const CELEBRATED = "design-inspector:milestones";
const COUNT_MS = 900;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function celebrated(): number {
  try {
    return Number(localStorage.getItem(CELEBRATED) ?? "-1");
  } catch {
    return -1;
  }
}
function remember(tier: number) {
  try {
    localStorage.setItem(CELEBRATED, String(tier));
  } catch {
    /* private mode: it may celebrate again, which is harmless */
  }
}

// The number counts up to a new total, as a score does (not on the first reading: that's where we are, not a gain)
function useCountUp(target: number, animate: boolean): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (target === start || !animate || reduced()) {
      from.current = target;
      return setShown(target);
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / COUNT_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, animate]);
  return shown;
}

export function Totals({ finished }: { finished: number }) {
  const [t, setT] = useState<View | null>(null);
  const [open, setOpen] = useState(false);
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null);
  const [party, setParty] = useState<number | null>(null); // the milestone just reached
  const last = useRef<number | null>(null);
  // Set once the first reading has been drawn: from then on a bigger total counts up
  const drawn = useRef(false);

  useEffect(() => {
    let alive = true;
    const read = () =>
      api("/__inspector/totals")
        .then((r) => r.json() as Promise<{ ok: boolean } & View>)
        .then((d) => alive && d.ok && setT(d))
        .catch(() => undefined);
    void read();
    const timer = setInterval(read, POLL_MS);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [finished]);

  // A new saving: float it; a new milestone: celebrate it (the first reading only sets where we are)
  const saved = t?.all.saved ?? 0;
  useEffect(() => {
    if (!t) return;
    const before = last.current;
    last.current = saved;
    const tier = tierOf(saved);
    if (before === null) {
      if (celebrated() < 0) remember(tier); // first time on this browser: milestones already passed aren't news
      return;
    }
    if (saved > before) setGain({ n: saved - before, key: Date.now() });
    if (tier > celebrated() && tier > 0) {
      remember(tier);
      setParty(tier);
    }
  }, [saved, t]);
  useEffect(() => {
    if (party === null) return;
    const off = setTimeout(() => setParty(null), 4200);
    return () => clearTimeout(off);
  }, [party]);

  const shown = useCountUp(saved, drawn.current);
  useEffect(() => {
    if (t) drawn.current = true;
  }, [t]);
  if (!t) return null;
  const tier = tierOf(saved);
  const now = TIERS[tier];
  const next = TIERS[tier + 1];
  const progress = next ? Math.min(1, (saved - now.at) / (next.at - now.at)) : 1;
  const since = new Date(t.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const backtestDate = new Date(`${t.backtest.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const look = { "--tier-from": now.from, "--tier-to": now.to, "--tier-glow": now.glow } as CSSProperties;

  return (
    <div className={styles.totals} style={look}>
      <button
        type="button"
        className={styles.totalsButton}
        data-tier={tier}
        data-shine={!!now.shine}
        data-party={party !== null}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={`Tokens saved by uberdesigner · ${next ? `${k(next.at - saved)} to ${next.name}` : now.name}`}
      >
        <span className={styles.totalsTop}>
          <span className={styles.totalsLabel}>Tokens Saved by uberdesigner</span>
          <strong>{k(shown)}</strong>
        </span>
        <span className={styles.totalsBar} aria-hidden="true">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
        {gain && (
          <span key={gain.key} className={styles.totalsGain} onAnimationEnd={() => setGain(null)} aria-hidden="true">
            +{k(gain.n)}
          </span>
        )}
        {party !== null && (
          <span className={styles.totalsSparks} aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ "--a": `${(i / 14) * 360}deg`, "--d": `${38 + (i % 3) * 14}px` } as CSSProperties} />
            ))}
          </span>
        )}
      </button>
      {party !== null && (
        <p className={styles.totalsToast} role="status">
          {TIERS[party].name}! Tokens saved by uberdesigner.
        </p>
      )}
      {open && (
        <div className={styles.totalsPop} role="dialog" aria-label="Tokens saved">
          <dl>
            <dt>Tokens saved</dt>
            <dd>{t.all.saved.toLocaleString()}</dd>
            <dt>Tokens used</dt>
            <dd>{t.all.used.toLocaleString()}</dd>
            <dt>Changes</dt>
            <dd>{t.all.changes.toLocaleString()}</dd>
          </dl>
          <ol className={styles.totalsTiers}>
            {TIERS.slice(1).map((x, i) => (
              <li key={x.at} data-reached={saved >= x.at} style={{ "--tier-from": x.from, "--tier-to": x.to } as CSSProperties}>
                <i />
                {x.name}
                {i + 1 === tier && <small>now</small>}
              </li>
            ))}
          </ol>
          {t.site && (
            <p className={styles.totalsSite}>
              This site: {k(t.site.saved)} saved, {k(t.site.used)} used, {t.site.changes} change{t.site.changes === 1 ? "" : "s"}
            </p>
          )}
          <p className={styles.totalsNote}>Across every site and chat on this computer since {since}.</p>
          <p className={styles.totalsNote}>
            <strong>How it's estimated.</strong> Savings are our own estimate, from a backtest on our test sites ({backtestDate}):
            the same {t.backtest.cases} everyday changes, made with plain Claude Code, used a median of {k(t.backtest.claudeCode)} tokens
            each; through uberdesigner, {k(t.backtest.inspector)}. Each change you make here counts the difference (typed text,
            links and sliders use no tokens, so they count all of it). Tokens are weighted the way usage is priced: a
            token read again from cache counts a tenth, a token written to cache 1.25, output 5. Claude Code's plans don't
            publish how they count, so this is the closest fair measure. Nothing runs on your computer to measure it.{" "}
            <a href="https://github.com/bogdan239/uberdesigner-studio/blob/main/docs/methodology.md" target="_blank" rel="noopener noreferrer">
              The method in full, on GitHub
            </a>
            .
          </p>
          <p className={styles.totalsNote}>
            <strong>uberdesigner studio.</strong> © 2026 Advanced Design Technologies Ltd. Free software under the GNU Affero General
            Public License, version 3, with no warranty. The licence and the notice are in this site's folder, in{" "}
            <code>.inspector/tool/</code>.
          </p>
        </div>
      )}
    </div>
  );
}
