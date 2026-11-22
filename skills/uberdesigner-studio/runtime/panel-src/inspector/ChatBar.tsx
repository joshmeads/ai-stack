import { api } from "./api";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isPickedObject, kindOf, type Part } from "./parts";
import { LayerIcon } from "./LayerIcon";
import { useClaudeStatus } from "./claudeStatus";
import { ClaudeConnection } from "./ClaudeConnection";
import { active, k, type ContextItem, type Job, type Jobs } from "./jobs";
import { pageFacts,
  BUDGETS,
  BYTES_PER_TOKEN,
  CODE_FILE,
  EFFORTS,
  MODELS,
  changesOf,
  modeOf,
  optionsFor,
  startChange,
  tokensFor,
  useSizes,
  type Settings,
} from "./change";
import styles from "./Inspector.module.css";
import e from "./Editor.module.css";

// The chat bar under the site, where Figma keeps its toolbar: ask for a change to the picked layer (or the whole
// site). It shows what the change would cost before you run it; clicking the cost opens what it sends above the bar
// (the files picked automatically, or picked by hand). The change itself then lives on as a card in AI changes.

type Preview = { sources: ContextItem[]; tokens: number; eta: { seconds: number; basis: string } };

type Props = {
  part: Part;
  jobs: Jobs;
  settings: Settings;
  onSettings: (s: Settings) => void;
  manual: string[] | null;
  onManual: (m: string[] | null | ((m: string[] | null) => string[] | null)) => void;
  replyTo: Job | null;
  onReplyTo: (j: Job | null) => void;
  blocked: string | null;
  onWholeSite: () => void;
  seed?: { text: string; n: number } | null; // text put in the box from elsewhere ("Add new object"), focused and lit up
  onExplore: () => void; // "Explore 500+ Prompts": the editor asks before opening uberdesigner's library
};

const MAX_ROWS = 6;
// The Whole site run's limit, by size rather than price (Claude Code caps a run by spend: these are those caps)
const BUDGET_LABELS: Record<number, string> = { 0.5: "Small limit", 1: "Medium limit", 2: "Large limit", 5: "Very large limit" };

const ASK_NAME = 24; // letters of a layer's name the box's question has room for on one line

export function ChatBar({ part, jobs, settings, onSettings, manual, onManual, replyTo, onReplyTo, blocked, onWholeSite, seed, onExplore }: Props) {
  const mode = modeOf(part);
  const siteWide = mode === "project";
  const [request, setRequest] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [details, setDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claude = useClaudeStatus();
  const files = manual ?? part.edit;
  const job = changesOf(part, jobs)[0] ?? null;
  const sizes = useSizes(siteWide ? [] : optionsFor(part, files), job?.state);
  const input = useRef<HTMLTextAreaElement>(null);
  const setupNeeded = !claude.ready && (claude.status !== null || claude.failed); // not while it's still being asked

  // A new part starts fresh
  useEffect(() => {
    setError(null);
    setDetails(false);
  }, [part]);

  // The box grows with what's typed, up to a few lines
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    // Empty: one line (a placeholder never makes it taller)
    if (!request) return void (el.style.height = "");
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 12)}px`;
  }, [request]);

  const unkept = isPickedObject(part.id);
  // What the change would send: worked out by the dev server from the part and the request (debounced while typing)
  useEffect(() => {
    if (siteWide) return setPreview(null);
    const t = setTimeout(() => {
      api("/__inspector/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An object that was only picked isn't in the map yet: what its layer would send is the most it can cost
        body: JSON.stringify({ partId: unkept ? part.parent : part.id, request, files: manual ?? undefined, page: manual ? undefined : pageFacts(unkept ? (part.parent ?? part.id) : part.id) }),
      })
        .then((r) => r.json() as Promise<({ ok: true } & Preview) | { ok: false }>)
        .then((d) => setPreview(d.ok ? d : null))
        .catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [part, request, manual, siteWide]);

  // Files a change created join a hand-picked list (automatic context finds them on its own next time)
  const settledKey = job && !active(job) ? job.id : null;
  useEffect(() => {
    if (!job || active(job)) return;
    const touched = (job.files ?? []).filter((f) => CODE_FILE.test(f));
    if (touched.length) onManual((m) => (m ? [...new Set([...m, ...touched])] : m));
    if (job.error && /log ?in|logged/i.test(job.error)) void claude.check();
  }, [settledKey]);

  // "Add new object": the box gets the start of the request, the cursor at its end, and lights up for a moment
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!seed) return;
    setRequest(seed.text);
    setLit(true);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(seed.text.length, seed.text.length);
    });
    const t = setTimeout(() => setLit(false), 1800);
    return () => clearTimeout(t);
  }, [seed?.n]);

  // "Reply" on a change puts the cursor here
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const estimate = manual ? tokensFor(part, request, files, sizes) : (preview?.tokens ?? tokensFor(part, request, files, sizes));
  const runningCount = jobs.jobs.filter((j) => j.state === "running").length;
  const willQueue = (!!job && active(job)) || runningCount >= jobs.max || jobs.jobs.some((j) => j.mode === "project" && active(j));
  const canRun = claude.ready && !!request.trim() && !blocked && (siteWide || files.length > 0);
  const toggle = (f: string) => onManual((m) => ((m ?? part.edit).includes(f) ? (m ?? part.edit).filter((x) => x !== f) : [...(m ?? part.edit), f]));

  const send = async () => {
    if (!canRun) return;
    setError(null);
    try {
      const next = await startChange({ part, request, continuing: replyTo, settings, manual, jobs });
      if (manual) onManual(next);
      setRequest("");
      onReplyTo(null);
      setDetails(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the change");
    }
  };

  const placeholder = replyTo
    ? "Your reply"
    : siteWide
      ? "What should change across the site?"
      : // A long name (an object named by its own words) is already on the chip beside the box: one line asks the rest
        part.label.length > ASK_NAME
        ? "What should change here?"
        : `What should change in the ${part.label.toLowerCase()}?`;

  return (
    <div className={e.chat}>
      {(details || setupNeeded) && (
        <div className={e.chatPop}>
          <ClaudeConnection status={claude.status} ready={claude.ready} failed={claude.failed} onCheck={() => void claude.check()} />
          {claude.ready && !siteWide && (
            <div className={styles.context}>
              <div className={styles.contextHead}>
                <span>{manual ? "Sends the files you picked" : "Sends, picked automatically for this part"}</span>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => onManual(manual ? null : [...new Set([...part.edit, ...(preview?.sources.map((x) => x.file) ?? [])])])}
                >
                  {manual ? "back to automatic" : "pick files"}
                </button>
              </div>
              {!manual &&
                (preview?.sources ?? []).map((x) => (
                  <div key={x.file} className={styles.contextItem} title={x.note}>
                    <code>{x.file.replace(/^src\//, "")}</code>
                    <span>
                      {x.note} · ~{k(Math.round(x.chars / 3.6))}
                    </span>
                  </div>
                ))}
              {manual && (
                <div className={styles.picks}>
                  {optionsFor(part, files).map((f) => (
                    <label key={f} className={styles.pick} data-extra={!part.edit.includes(f)}>
                      <input type="checkbox" checked={files.includes(f)} onChange={() => toggle(f)} />
                      <span>{f.replace(/^src\//, "")}</span>
                      <em>{sizes[f] ? `~${k(Math.round(sizes[f] / BYTES_PER_TOKEN))}` : ""}</em>
                    </label>
                  ))}
                </div>
              )}
              {preview && !manual && (
                <span className={styles.eta}>Usually about {Math.max(5, Math.round(preview.eta.seconds / 5) * 5)} s ({preview.eta.basis})</span>
              )}
            </div>
          )}
          {claude.ready && siteWide && (
            <p className={styles.hintBox}>
              Claude Code works through the project like it would in a terminal: it reads what it needs, edits files, can run{" "}
              <code>pnpm add</code> and checks types. Each step reads its instructions and the files again, so in our tests an
              everyday change cost about 60k tokens (weighted the way usage is priced) and a big one (a 3D scene) far more.
              It stops at the limit you pick. Pick a layer instead when the change fits in one part: about 6× fewer tokens.
            </p>
          )}
        </div>
      )}

      <div className={e.chatBox} data-lit={lit}>
        {replyTo && (
          <p className={styles.replying}>
            Replying to “{replyTo.request.slice(0, 60)}”
            <button type="button" className={styles.link} onClick={() => onReplyTo(null)}>
              cancel
            </button>
          </p>
        )}
        <div className={e.chatMain}>
          <div className={e.chatInput}>
          <button
            type="button"
            className={e.target}
            data-site={siteWide}
            onClick={siteWide ? undefined : onWholeSite}
            title={siteWide ? "Changes across the whole site. Pick a layer to change just that part." : "Change the whole site instead"}
          >
            {!siteWide && <LayerIcon kind={kindOf(part, null)} />}
            <span>{part.label}</span>
            {!siteWide && <i aria-hidden="true">×</i>}
          </button>
          <textarea
            ref={input}
            rows={1}
            value={request}
            disabled={!claude.ready}
            placeholder={claude.ready ? placeholder : "Connect Claude Code to ask for changes"}
            onChange={(ev) => setRequest(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                void send();
              }
            }}
          />
          </div>
          <button type="button" className={`${styles.primary} ${e.send}`} disabled={!canRun} onClick={() => void send()}>
            {replyTo ? "Reply" : willQueue ? "Queue" : "Run"}
          </button>
        </div>
        <div className={e.chatMeta}>
          <select value={settings.model} onChange={(ev) => onSettings({ ...settings, model: ev.target.value })} aria-label="Model">
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={settings.effort} onChange={(ev) => onSettings({ ...settings, effort: ev.target.value })} aria-label="Effort">
            {EFFORTS.map((x) => (
              <option key={x} value={x}>
                {x[0].toUpperCase() + x.slice(1)} effort
              </option>
            ))}
          </select>
          {siteWide ? (
            <select value={settings.budget} onChange={(ev) => onSettings({ ...settings, budget: +ev.target.value })} aria-label="Budget">
              {BUDGETS.map((b) => (
                <option key={b} value={b}>
                  {BUDGET_LABELS[b] ?? "No limit"}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              className={e.cost}
              onClick={() => claude.ready && setDetails((d) => !d)}
              aria-expanded={details}
              title={details ? "Hide what it sends" : "What it sends: the files picked for this change"}
            >
              {unkept && preview && !manual ? "up to " : "≈ "}
              {k(estimate)} tokens{preview && !manual ? ` ~${Math.max(5, Math.round(preview.eta.seconds / 5) * 5)} s` : ""}
            </button>
          )}
          {siteWide && claude.ready && (
            <button type="button" className={e.howLink} onClick={() => setDetails((d) => !d)} aria-expanded={details}>
              {details ? "Hide" : "How it works"}
            </button>
          )}
          <span className={e.grow} />
          <button type="button" className={e.explore} onClick={onExplore} title="uberdesigner's prompt library, on uberdesigner.ai">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8.03971 0C10.2303 0 12.2163 0.872147 13.6665 2.28554H9.3508C9.81152 2.94181 10.193 3.71531 10.473 4.57228H15.3072C15.6464 5.2828 15.8841 6.05082 16 6.85783H10.947C10.9836 7.2307 11.0035 7.61179 11.0035 7.99941C11.0035 8.38741 10.9837 8.77013 10.947 9.14337H16C15.884 9.95026 15.6465 10.7185 15.3072 11.4289H10.473C10.1931 12.2855 9.81132 13.0585 9.3508 13.7145H13.6665C12.2163 15.1278 10.2303 16 8.03971 16C3.67726 15.9998 0.126457 12.5428 0.00240565 8.23275C0.00082664 8.15543 0 8.07726 0 7.99941C3.85122e-06 7.92139 0.000812699 7.84353 0.00240565 7.76606C0.126807 3.45624 3.67748 0.000257321 8.03971 0Z"
              />
            </svg>
            <span>Explore 500+ Prompts</span>
          </button>
        </div>
        {blocked && <p className={styles.phone}>{blocked}</p>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
