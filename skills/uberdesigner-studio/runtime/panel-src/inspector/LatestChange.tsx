import { useEffect, useRef, useState } from "react";
import type { Part } from "./parts";
import { active, changedSomething, clock, fraction, k, leftLabel, stepLabel, useNow, type Job, type Jobs } from "./jobs";
import { NO_EXTRAS, changesOf, startChange, tokensFor, useSizes, BYTES_PER_TOKEN, type Extras, type Settings } from "./change";
import styles from "./Inspector.module.css";

// The picked layer's latest change, in the right column: its progress, what Claude did, what it cost, and Reply /
// Undo. A change that needs a package or another file lists it here with checkboxes, and "Allow and run" sends it
// again as one call. The card for the same change says less and stays visible while you pick other layers.

// When to suggest stopping (the person decides; nothing stops on a clock)
const SLOW_MS = { part: 5 * 60 * 1000, project: 10 * 60 * 1000 };
const QUIET_MS = 2 * 60 * 1000; // no new output for this long

type Props = {
  part: Part;
  jobs: Jobs;
  settings: Settings;
  manual: string[] | null;
  onManual: (m: string[] | null) => void;
  onReply: (j: Job) => void;
  onTry: () => void;
  blocked: string | null;
};

export function LatestChange({ part, jobs, settings, manual, onManual, onReply, onTry, blocked }: Props) {
  const job = changesOf(part, jobs)[0] ?? null;
  const running = !!job && active(job);
  const now = useNow(running);
  const [allow, setAllow] = useState<Extras>(NO_EXTRAS);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const files = manual ?? part.edit;
  const sizes = useSizes([...files, ...(job?.needs?.files ?? [])], job?.state);

  // When it settles: tick what it asks for
  const settledKey = job && !running ? job.id : null;
  useEffect(() => {
    const n = job?.needs;
    setAllow(n ? { packages: n.packages, files: n.files, allowNew: n.newFiles.length > 0 } : NO_EXTRAS);
    setError(null);
  }, [settledKey]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [job?.log.length]);

  if (!job) return null;

  const act = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const allowAndRun = act(async () => {
    const next = await startChange({ part, request: job.request, continuing: job, settings, manual, extras: allow, jobs });
    if (manual) onManual(next);
  });

  return (
    <div className={styles.result} data-state={job.state}>
      <p className={styles.jobHead}>
        <strong>Latest change</strong> · {job.request.slice(0, 80)}
      </p>
      {running && (
        <>
          <div className={styles.bar}>
            <span style={{ transform: `scaleX(${fraction(job, now)})` }} data-waiting={job.state === "queued"} />
          </div>
          <div className={styles.progress}>
            <span className={styles.eta}>
              {job.state === "queued" ? "Waiting its turn" : `${stepLabel(job)} · ${clock(now - job.started)}`}
              {job.state === "running" && leftLabel(job, now) ? ` · ${leftLabel(job, now)}` : ""}
            </span>
            <button type="button" className={styles.ghost} disabled={job.stopped} onClick={act(() => jobs.stop(job.id))}>
              {job.state === "queued" ? "Cancel" : "Stop"}
            </button>
          </div>
        </>
      )}
      {job.log.length > 0 && (
        <details className={styles.moreLog}>
          <summary>Details</summary>
          <ol className={styles.log} ref={logRef}>
            {job.log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </details>
      )}
      {job.state === "running" && now - job.started > SLOW_MS[job.mode] && (
        <p className={styles.advice}>
          {now - job.progress.lastAt > QUIET_MS
            ? `This is taking longer than most changes, and nothing new has come in for ${clock(now - job.progress.lastAt)}. It may be stuck: stopping is probably right.`
            : "This is taking longer than most changes, but it's still writing. You can keep waiting, or stop it" +
              (job.mode === "part" ? " (nothing changes until it finishes) and split the request into smaller steps." : " (what it has done so far is kept as a version you can undo).")}
        </p>
      )}
      {!running && (
        <>
          {job.undone && <p className={styles.phone}>Undone: this change was taken back.</p>}
          {job.error ? <p className={job.stopped ? styles.phone : styles.error}>{job.error}</p> : <p>{job.summary || "Done."}</p>}
          {/* What the page itself showed once the change was on it, when that isn't what was asked (observe.ts) */}
          {job.observed?.note && !job.undone && <p className={styles.note}>{job.observed.note}</p>}
          {job.needs && !job.files?.length && (
            <div className={styles.needs}>
              <strong>To do this for the {part.label.toLowerCase()}, Claude needs:</strong>
              {job.needs.why && <p className={styles.phone}>{job.needs.why}</p>}
              {job.needs.packages.map((p) => (
                <label key={p} className={styles.pick}>
                  <input
                    type="checkbox"
                    checked={allow.packages.includes(p)}
                    onChange={() => setAllow((a) => ({ ...a, packages: a.packages.includes(p) ? a.packages.filter((x) => x !== p) : [...a.packages, p] }))}
                  />
                  <span>install {p}</span>
                  <em>package</em>
                </label>
              ))}
              {job.needs.files.map((f) => (
                <label key={f} className={styles.pick}>
                  <input
                    type="checkbox"
                    checked={allow.files.includes(f)}
                    onChange={() => setAllow((a) => ({ ...a, files: a.files.includes(f) ? a.files.filter((x) => x !== f) : [...a.files, f] }))}
                  />
                  <span>edit {f.replace(/^src\//, "")}</span>
                  <em>{sizes[f] ? `~${k(Math.round(sizes[f] / BYTES_PER_TOKEN))}` : ""}</em>
                </label>
              ))}
              {job.needs.newFiles.length > 0 && (
                <label className={styles.pick}>
                  <input type="checkbox" checked={allow.allowNew} onChange={() => setAllow((a) => ({ ...a, allowNew: !a.allowNew }))} />
                  <span>create {job.needs.newFiles.map((f) => f.replace(/^src\//, "")).join(", ")}</span>
                  <em>new</em>
                </label>
              )}
              <div className={styles.runRow}>
                <span className={styles.estimate}>One call · ≈ {k(tokensFor(part, job.request, [...new Set([...files, ...allow.files])], sizes))} in</span>
                <button type="button" className={styles.primary} disabled={!!blocked} onClick={() => void allowAndRun()}>
                  Allow and run
                </button>
              </div>
            </div>
          )}
          <p className={styles.phone}>
            {job.files?.length ? `Changed ${job.files.join(", ")}` : "No files changed"}
            {job.retried ? " · asked again after another change landed first" : ""}
            {job.usage && (
              <>
                {" "}
                · {job.usage.input.toLocaleString()} in / {job.usage.output.toLocaleString()} out
                {job.usage.turns && job.mode === "project" ? ` · ${job.usage.turns} steps` : ""}
                {job.saved ? ` · saved ~${job.saved.toLocaleString()}` : ""} · {job.usage.seconds}s
              </>
            )}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.ghost} onClick={() => onReply(job)}>
              Reply
            </button>
            {job.entry && (
              <button type="button" className={styles.ghost} onClick={onTry} title="Hover and click the site itself">
                Try it on the page
              </button>
            )}
            {changedSomething(job) && (
              <button type="button" className={styles.ghost} onClick={act(() => jobs.undo(job.thread))}>
                Undo this
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
