// The queue: which changes may start now (a whole-site change alone, one change per part, a few at once), starting and
// stopping them, and the cards kept on disk so a restart of the dev server loses nothing.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { account } from "./savings.ts";
import { containsNow, withWriteLock } from "./history.ts";
import { type Job, jobs, KEEP_FINISHED, KEEP_RESOLVED, MAX_PARALLEL, procs, type RunRequest } from "./jobs.ts";
import { commit, runPart } from "./part.ts";
import { runProject } from "./project.ts";
import { readMap, ROOT, STATE } from "./site.ts";

export const running = () => jobs.filter((x) => x.state === "running");
export const pending = () => jobs.filter((x) => x.state === "queued" || x.state === "running");
export const requests = new Map<string, RunRequest>();

// Start what can start, in the order asked: a Whole site change waits for the others and runs alone; a part waits
// while a change to the same part runs; at most MAX_PARALLEL at once
export function pump() {
  for (const j of jobs.filter((x) => x.state === "queued")) {
    const now = running();
    if (now.some((x) => x.mode === "project")) return;
    if (j.mode === "project") {
      if (!now.length) begin(j);
      return;
    }
    if (now.length >= MAX_PARALLEL) return;
    if (now.some((x) => x.partId === j.partId)) continue;
    begin(j);
  }
}

export function begin(j: Job) {
  const r = requests.get(j.id);
  if (!r) return;
  j.state = "running";
  j.started = Date.now();
  (r.mode === "project" ? runProject(j, r).then(() => withWriteLock(() => commit(j, r))) : runPart(j, r))
    .then(() => {
      j.state = "done";
    })
    .catch(async (err: unknown) => {
      j.error = err instanceof Error ? err.message : String(err);
      // Whatever the agent managed before it stopped is still kept as a version, so it can be undone
      await withWriteLock(() => commit(j, r, true)).catch(() => undefined);
      j.state = "error";
    })
    .finally(() => {
      j.finished = Date.now();
      account(ROOT, j);
      requests.delete(j.id);
      forgetOld();
      saveCards();
      pump();
    });
}

// Old cards that changed nothing go first, then resolved ones (kept, or taken out of the page) past their own limit;
// cards with a change waiting for review are only dropped past a high limit. History has every version either way.
export function forgetOld() {
  const now = new Set(containsNow());
  const finished = () => jobs.filter((x) => x.state === "done" || x.state === "error");
  const drop = (list: Job[], keep: number) => list.slice(0, Math.max(0, list.length - keep)).forEach((old) => jobs.splice(jobs.indexOf(old), 1));
  const changed = (x: Job) => !!x.entry && !!x.files?.length;
  drop(finished().filter((x) => !changed(x)), KEEP_FINISHED);
  drop(finished().filter((x) => changed(x) && (x.kept || !now.has(x.entry as string))), KEEP_RESOLVED);
  drop(finished(), KEEP_RESOLVED + KEEP_FINISHED * 4);
}

// --- cards on disk, so a restart of the dev server doesn't lose what's waiting for review
export const cardsFile = () => join(STATE, "cards.json");
export function saveCards() {
  try {
    mkdirSync(STATE, { recursive: true });
    const keep = jobs.filter((x) => x.state === "done" || x.state === "error").map((x) => ({ ...x, log: x.log.slice(-40) }));
    writeFileSync(cardsFile(), JSON.stringify(keep) + "\n");
  } catch {
    /* cards are a convenience: History has every version either way */
  }
}
export function loadCards() {
  try {
    const saved = JSON.parse(readFileSync(cardsFile(), "utf8")) as Job[];
    jobs.splice(0, jobs.length, ...saved.filter((x) => x.state === "done" || x.state === "error").map((x) => ({ ...x, thread: x.thread ?? x.id, try: x.try ?? 1, model: x.model ?? "claude-opus-5-5", effort: x.effort ?? "medium" })));
  } catch {
    /* none yet */
  }
}

export const threadOf = (id: string) => jobs.filter((x) => x.thread === id).sort((a, b) => a.try - b.try);

export function startRun(r: RunRequest): Job {
  if (!r.request?.trim()) throw new Error("Say what to change");
  const latest = r.thread ? threadOf(r.thread).at(-1) : undefined;
  r.model ||= latest?.model ?? "";
  r.effort ||= latest?.effort ?? "medium";
  if (!/^claude-[a-z0-9-]+$/.test(r.model) || !/^(low|medium|high|xhigh|max)$/.test(r.effort)) throw new Error("Bad model or effort");
  // A refinement continues its card: same part and kind, and the earlier tries (what was asked, what Claude did) as
  // context, so "make it more like ice" means something
  const earlier = r.thread ? threadOf(r.thread) : [];
  if (r.thread && !earlier.length) throw new Error("That change's card is gone: start a new request");
  if (earlier.some((x) => x.state === "queued" || x.state === "running")) throw new Error("Wait for this change's current try to finish");
  if (earlier.length) {
    const first = earlier[0];
    r.mode = first.mode;
    r.part = first.part;
    r.partId = first.partId;
    const part = readMap().parts?.find((x) => x.id === first.partId);
    if (part) r.prompt = [...part.prompt.map((x) => `${x.where}: ${x.text}`), ...(part.note ? [part.note] : [])].join("\n");
    const now = new Set(containsNow());
    r.previous = earlier
      .map((x) => `Try ${x.try}${x.entry && !now.has(x.entry) ? " (the person took this one back)" : ""}: ${x.request}\n→ ${x.error ?? x.summary ?? "(no answer)"}${x.files?.length ? ` [changed ${x.files.join(", ")}]` : ""}`)
      .join("\n\n");
    r.session = [...earlier].reverse().find((x) => x.session)?.session;
  }
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const j: Job = {
    id,
    thread: earlier[0]?.thread ?? id,
    try: earlier.length + 1,
    model: r.model,
    effort: r.effort,
    mode: r.mode,
    part: r.part,
    request: r.request.trim(),
    state: "queued",
    queuedAt: Date.now(),
    started: Date.now(),
    log: [],
    progress: { phase: r.mode === "project" ? "working" : "preparing", written: 0, lastAt: Date.now() },
    partId: r.mode === "project" ? undefined : r.partId,
  };
  jobs.push(j);
  requests.set(j.id, r);
  pump();
  return j;
}

export function stopJob(id: string) {
  const j = jobs.find((x) => x.id === id);
  if (!j || (j.state !== "queued" && j.state !== "running")) throw new Error("That change isn't running");
  j.stopped = true;
  if (j.state === "queued") {
    j.state = "error";
    j.error = "Cancelled before it started. Nothing was changed.";
    requests.delete(j.id);
    pump();
    return;
  }
  procs.get(id)?.kill();
}
