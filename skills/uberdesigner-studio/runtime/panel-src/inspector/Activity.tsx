import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useShield } from "./shield";
import { active, changedSomething, clock, fraction, k, leftLabel, stepLabel, useNow, type Jobs, type Thread } from "./jobs";
import { numbersFor } from "./numbers";
import styles from "./Inspector.module.css";

// One card per change, stacked like a phone's notifications. A change is a small loop: ask, look, then refine it
// ("not quite, make it more like ice"), keep it, or undo it.
// - While Claude works: the part, the request, a progress bar with the time left.
// - Then review: the arrows step through Original and every try, each with its request and result, and the live page
//   shows that state; "Use this one" goes back to it (later tries are taken back) and refinements continue from there.
//   "Not quite?" sends a refinement with the earlier tries as context; Keep accepts it; Undo takes back every try,
//   keeping changes made after it. Either way the card moves to the resolved list (in the editor), where a kept change
//   can still be undone and one that is out of the page brought back.

const OPEN_CARDS = 3;

// Cards already shown in this tab don't slide in again when the page reloads (Before/After and saved changes reload it)
const SEEN = "design-inspector:seen-cards";
const seen: Set<string> = (() => {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN) ?? "[]") as string[]);
  } catch {
    return new Set<string>();
  }
})();
const markSeen = (id: string) => {
  if (seen.has(id)) return false;
  seen.add(id);
  try {
    sessionStorage.setItem(SEEN, JSON.stringify([...seen].slice(-60)));
  } catch {
    /* private mode: cards just slide in again */
  }
  return true;
};

// place: "side" in the editor's right column ("corner" was the site's own page, which now opens in the editor; the
// folding of a long corner list is kept for a list drawn that way).
// only: in the editor, which cards this list holds: "active" (AI changes: running, to review, needing an OK, nothing
// changed) or "resolved" (the Resolved tab: kept changes and changes that are out of the page; they rest there and
// can't be taken off the list).
type Props = { jobs: Jobs; side: "left" | "right"; place?: "corner" | "side"; only?: "active" | "resolved"; onOpen: (partId: string | null) => void };

export function Activity({ jobs, side, place = "corner", only = "active", onOpen }: Props) {
  const list = only === "resolved" ? [] : jobs.threads.filter((t) => !t.resolved);
  const resolved = place === "side" && only === "resolved" ? jobs.threads.filter((t) => t.resolved) : [];
  const [all, setAll] = useState(false);
  const now = useNow(list.some((t) => t.active));
  const box = useRef<HTMLDivElement>(null);
  useShield(box, list.length + resolved.length > 0); // a space typed in a card stays in the card
  const numbers = numbersFor(jobs.threads); // a change's number: on its card here, on its pin over the page
  if (!list.length && !resolved.length) return null;
  const folds = place === "corner" && list.length > OPEN_CARDS;
  const shown = all || !folds ? list : list.slice(0, OPEN_CARDS);
  const closable = list.filter((t) => !t.active && !t.changed);
  return (
    <div ref={box} className={styles.cards} data-side={side} data-place={place} aria-live="polite">
      {shown.map((t) => (
        <Card key={t.id} thread={t} number={numbers.get(t.id)} now={now} jobs={jobs} onOpen={onOpen} />
      ))}
      {(folds || closable.length > 1) && (
        <div className={styles.cardsFoot}>
          {folds && (
            <button type="button" onClick={() => setAll((a) => !a)}>
              {all ? "Show fewer" : `${list.length - OPEN_CARDS} more`}
            </button>
          )}
          {closable.length > 1 && (
            <button type="button" onClick={() => closable.forEach((t) => void jobs.dismiss(t.id))}>
              Clear the rest
            </button>
          )}
        </div>
      )}
      {resolved.map((t) => (
        <Card key={t.id} thread={t} number={numbers.get(t.id)} now={now} jobs={jobs} onOpen={onOpen} />
      ))}
    </div>
  );
}

type Kind = "queued" | "running" | "review" | "kept" | "needs" | "nothing" | "failed" | "stopped" | "undone";

const kindOf = (t: Thread): Kind => {
  const j = t.latest;
  if (j.state === "queued") return "queued";
  if (j.state === "running") return "running";
  if (t.undone) return "undone";
  if (t.changed) return t.kept ? "kept" : "review";
  if (j.stopped) return "stopped";
  if (j.state === "error") return "failed";
  if (j.needs) return "needs";
  return "nothing";
};

const TITLE: Record<Kind, string> = {
  queued: "Queued",
  running: "Changing",
  review: "Changed",
  kept: "Kept",
  needs: "Needs your OK",
  nothing: "No change",
  failed: "Didn't work",
  stopped: "Stopped",
  undone: "Not in the page now",
};

function Card({ thread: t, number, now, jobs, onOpen }: { thread: Thread; number: number | undefined; now: number; jobs: Jobs; onOpen: (partId: string | null) => void }) {
  const j = t.latest;
  const kind = kindOf(t);
  const [fresh] = useState(() => markSeen(t.id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState("");
  const partId = j.mode === "project" ? "site" : (j.partId ?? null);
  // Which state the card shows: a try number, 0 for the original, null for the latest
  const [view, setView] = useState<number | null>(null);
  const current = t.tries.filter(changedSomething).reduce((n, x) => Math.max(n, x.try), 0); // the try the files are at
  // Where the card rests: the latest try, or the one chosen with "Use this one" when later tries were taken back
  const home = !active(j) && j.undone && current > 0 ? current : j.try;
  const at = view ?? home;
  const shown = at === 0 || at === j.try ? null : (t.tries.find((x) => x.try === at) ?? null);
  const before = jobs.comparing?.thread === t.id;
  const go = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const step = (to: number) =>
    void go("step", async () => {
      setView(to === home ? null : to);
      const target = t.tries.find((x) => x.try === to);
      // The page shows that state: later tries reversed (a try that was taken back has nothing of its own to show)
      if (to >= current || target?.undone) await jobs.compare(t.id, "after");
      else await jobs.compare(t.id, to);
    })();
  const refine = go("refine", async () => {
    if (!more.trim()) return;
    await jobs.refine(t.id, more.trim());
    setMore("");
  });

  // What to say under the request: the shown try's answer (the latest's by default), or why it stopped
  const shownText =
    at === 0
      ? "The part as it was before this change."
      : shown
        ? shown.undone
          ? `Taken back. ${shown.summary ?? shown.error ?? ""}`
          : shown.error && !changedSomething(shown)
            ? `Didn't change anything: ${shown.error}`
            : (shown.summary ?? "")
        : null;
  const latestText = active(j)
    ? null
    : j.error && !changedSomething(j)
      ? t.changed
        ? `Try ${j.try} didn't change anything: ${j.error}`
        : j.error
      : kind === "needs"
        ? (j.needs?.why ?? j.summary)
        : !changedSomething(j) && t.changed
          ? `Try ${j.try} didn't change anything: ${j.summary || "no edits"}`
          : j.summary;
  const text = shownText ?? latestText;
  // Weighted the way usage is priced (as the savings counter counts them), raw for changes from before that
  const usage = t.tries.reduce((n, x) => n + (x.usage ? (x.usage.weighted ?? x.usage.input + x.usage.output) : 0), 0);
  // No prices: tokens, and what the change saved against a Claude Code run through the project
  const saved = t.tries.reduce((n, x) => n + (x.saved ?? 0), 0);
  const tries = t.tries.length > 1 ? ` · ${t.tries.length} tries` : "";
  const ask = at === 0 ? "Original" : (shown ?? j).request;
  const canStep = !active(j) && (t.changed || t.tries.some((x) => x.undone));
  const behind = at < current; // looking at an earlier state than the files hold
  // A finished card is solid and clickable as a whole: it takes you to its part (scrolls the page there and opens it in
  // the panel). Its own controls (buttons, the refine field) keep their clicks, and selecting its text doesn't jump.
  const ready = !active(j);
  const goToPart = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select, label, [contenteditable]")) return;
    if (window.getSelection()?.toString()) return;
    onOpen(partId);
  };

  return (
    <article
      className={styles.card}
      data-thread={t.id}
      data-number={number}
      data-kind={kind}
      data-fresh={fresh}
      data-ready={ready}
      onClick={ready ? goToPart : undefined}
      title={ready ? (j.mode === "project" ? "Open Whole site in the panel" : `Show ${j.part} on the page`) : undefined}
    >
      <div className={styles.cardTop}>
        <Glyph kind={kind} />
        <div className={styles.cardWhat}>
          <div className={styles.cardMeta}>
            <span className={styles.cardKind}>
              {before ? (jobs.comparing?.upTo ? `Showing try ${jobs.comparing.upTo}` : "Showing original") : TITLE[kind]}
              {tries}
            </span>
            <span>{j.state === "running" ? clock(now - j.started) : j.state === "queued" ? "waiting" : j.finished ? `took ${clock(j.finished - j.started)}` : ""}</span>
          </div>
          <button type="button" className={styles.cardPart} onClick={() => onOpen(partId)} title="Open this part in the panel">
            {number !== undefined && (
              <span className={styles.pin} data-on="card" aria-label={`Change ${number}`}>
                {number}
              </span>
            )}
            {j.mode === "project" ? "Whole site" : j.part}
          </button>
          <p className={styles.cardAsk}>{ask}</p>
        </div>
        {active(j) ? (
          <button type="button" className={styles.cardX} onClick={go("stop", () => jobs.stop(j.id))} disabled={!!busy || j.stopped} aria-label={j.state === "queued" ? "Cancel" : "Stop"} title={j.state === "queued" ? "Cancel" : "Stop"}>
            ■
          </button>
        ) : (
          !t.changed &&
          !t.resolved && (
            <button type="button" className={styles.cardX} onClick={go("close", () => jobs.dismiss(t.id))} aria-label="Close" title="Close">
              ✕
            </button>
          )
        )}
      </div>

      {active(j) && (
        <>
          <div className={styles.bar}>
            <span style={{ transform: `scaleX(${fraction(j, now)})` }} data-waiting={j.state === "queued"} />
          </div>
          <p className={styles.cardStep}>
            <span>{j.stopped ? "Stopping…" : stepLabel(j)}</span>
            <span>{j.state === "running" ? leftLabel(j, now) : ""}</span>
          </p>
        </>
      )}

      {text && <p className={styles.cardText}>{text}</p>}
      {(shown ?? j).observed?.note && !(shown ?? j).undone && at !== 0 && <p className={styles.note}>{(shown ?? j).observed?.note}</p>}
      {error && <p className={styles.cardError}>{error}</p>}

      {canStep && (
        <div className={styles.cardCompare}>
          <div className={styles.stepper} aria-label="Tries of this change">
            <button type="button" disabled={at <= 0 || !!busy} onClick={() => step(at - 1)} aria-label="Previous">
              ‹
            </button>
            <span>
              {at === 0 ? "Original" : `Try ${at} of ${t.tries.length}`}
              {shown?.undone ? " · taken back" : ""}
            </span>
            <button type="button" disabled={at >= j.try || !!busy} onClick={() => step(at + 1)} aria-label="Next">
              ›
            </button>
          </div>
          {behind && !shown?.undone && (
            <button
              type="button"
              className={styles.useThis}
              disabled={!!busy}
              onClick={go("choose", async () => {
                await jobs.choose(t.id, at);
                setView(null);
              })}
              title="Go back to this state: the tries after it are taken back, and you can keep refining from here"
            >
              {busy === "choose" ? "…" : "Use this one"}
            </button>
          )}
          <span className={styles.cardCost}>
            {k(usage)} tokens{saved > 0 ? ` · saved ~${k(saved)}` : ""}
          </span>
        </div>
      )}

      {!active(j) && (
        <form
          className={styles.cardMore}
          onSubmit={(e) => {
            e.preventDefault();
            void refine();
          }}
        >
          <input
            value={more}
            onChange={(e) => setMore(e.target.value)}
            placeholder={behind ? "Use this one first, then refine from it" : t.changed ? "Not quite? Say what to change…" : "Try again: say it differently…"}
            aria-label="Refine this change"
          />
          <button type="submit" disabled={!more.trim() || !!busy || behind}>
            {busy === "refine" ? "…" : "Send"}
          </button>
        </form>
      )}

      {!active(j) && (t.changed || kind === "needs" || kind === "undone") && (
        <div className={styles.cardActions}>
          {kind === "undone" && (
            <button
              type="button"
              className={styles.cardKeep}
              disabled={!!busy}
              title="Put this change back on the site as it is now. Everything made since stays."
              onClick={go("back", () => jobs.bringBack(t.id))}
            >
              {busy === "back" ? "Bringing back…" : "Bring back"}
            </button>
          )}
          {kind === "needs" && (
            <button type="button" onClick={() => onOpen(partId)}>
              Open
            </button>
          )}
          {t.changed && (
            <>
              <button type="button" disabled={!!busy} onClick={go("undo", () => jobs.undo(t.id))}>
                {busy === "undo" ? "Undoing…" : "Undo"}
              </button>
              {!t.kept && (
                <button type="button" className={styles.cardKeep} disabled={!!busy} onClick={go("keep", () => jobs.keep(t.id))}>
                  Keep
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

// The small animated icon on each card: a turning ring while it works, three dots while it waits, a check that draws
// itself when there's a change to review, a mark for anything else
function Glyph({ kind }: { kind: Kind }) {
  return (
    <span className={styles.glyph} data-kind={kind} aria-hidden="true">
      <svg viewBox="0 0 28 28" width="28" height="28">
        {kind === "running" && (
          <>
            <circle className={styles.glyphTrack} cx="14" cy="14" r="9" />
            <circle className={styles.glyphSpin} cx="14" cy="14" r="9" />
            <circle className={styles.glyphCore} cx="14" cy="14" r="3" />
          </>
        )}
        {kind === "queued" && [8, 14, 20].map((x, i) => <circle key={x} className={styles.glyphDot} style={{ animationDelay: `${i * 0.18}s` }} cx={x} cy="14" r="2.2" />)}
        {(kind === "review" || kind === "kept") && <path className={styles.glyphCheck} d="M8 14.5l4 4 8-9" />}
        {(kind === "needs" || kind === "failed") && <path className={styles.glyphMark} d="M14 8v7M14 19.5v.5" />}
        {(kind === "nothing" || kind === "stopped" || kind === "undone") && <path className={styles.glyphMark} d={kind === "undone" ? "M10 11h7a4 4 0 010 8h-5M10 11l3-3M10 11l3 3" : "M9 14h10"} />}
      </svg>
    </span>
  );
}
