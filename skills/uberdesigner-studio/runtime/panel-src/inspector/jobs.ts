import { api } from "./api";
import { reloadInPlace } from "./site";
import { useCallback, useEffect, useRef, useState } from "react";

// Every change Claude is making or has made in this dev-server session, shared by the cards, the part details and the
// page outlines. The dev server keeps the list (so it survives a reload); the panel polls it, often while something
// runs and rarely otherwise.

// weighted: counted the way usage is priced (server/savings.ts), what cards and the savings counter show
export type Usage = { input: number; output: number; costUsd: number; seconds: number; turns?: number; weighted?: number };
export type Mode = "part" | "project";
export type Phase = "preparing" | "thinking" | "writing" | "applying" | "checking" | "fixing" | "working";
export type Needs = { packages: string[]; files: string[]; newFiles: string[]; why?: string };
export type ContextItem = { file: string; note: string; chars: number };

export type Job = {
  id: string;
  thread: string; // the card: its first try's id
  try: number; // 1, then 2+ for refinements
  model: string;
  effort: string;
  mode: Mode;
  part: string; // the part's label
  partId?: string;
  mapChanged?: boolean; // it added or removed layers
  added?: string[]; // ids of the layers it added
  direct?: boolean; // written by the inspector itself, no Claude call
  observed?: { at: number; width: number; note: string }; // what the page showed once it had landed (observe.ts)
  saved?: number; // tokens saved against a Claude Code run through the project (server/savings.ts)
  request: string;
  state: "queued" | "running" | "done" | "error";
  queuedAt: number;
  started: number;
  finished?: number;
  log: string[];
  summary?: string;
  usage?: Usage;
  files?: string[];
  entry?: string; // the version it made
  session?: string;
  needs?: Needs;
  error?: string;
  stopped?: boolean;
  undone?: boolean; // its change is not in the page now (taken back, or left behind by going back in History): the server works it out
  kept?: boolean; // the person pressed Keep
  retried?: boolean;
  progress: { phase: Phase; written: number; lastAt: number; writingSince?: number };
  eta?: { seconds: number; outputChars: number; basis: string };
  context?: ContextItem[];
};

export const active = (j: Job) => j.state === "queued" || j.state === "running";
// A change that left the part different from before (and wasn't taken back)
export const changedSomething = (j: Job) => !!j.entry && !!j.files?.length && !j.undone;

// One card per change: its tries, oldest first, and the latest one. A card is resolved once nothing waits on the
// person: its change is in the page and was kept, or it is out of the page. Resolved cards rest in their own list and
// still act: a kept one can be undone, one that is out can be brought back.
export type Thread = { id: string; tries: Job[]; latest: Job; changed: boolean; active: boolean; undone: boolean; kept: boolean; resolved: boolean };
export function threadsOf(jobs: Job[]): Thread[] {
  const by = new Map<string, Job[]>();
  for (const j of [...jobs].reverse()) by.set(j.thread ?? j.id, [...(by.get(j.thread ?? j.id) ?? []), j]);
  return [...by.entries()]
    .map(([id, tries]) => {
      tries.sort((a, b) => (a.try ?? 1) - (b.try ?? 1));
      const latest = tries[tries.length - 1];
      const changed = tries.some(changedSomething);
      const busy = tries.some(active);
      const undone = tries.some((t) => t.undone) && !changed;
      const kept = tries.some((t) => t.kept);
      return { id, tries, latest, changed, active: busy, undone, kept, resolved: !busy && (undone || (changed && kept)) };
    })
    .sort((a, b) => Math.max(b.latest.queuedAt, b.latest.finished ?? 0) - Math.max(a.latest.queuedAt, a.latest.finished ?? 0));
}

const FAST_MS = 700;
let LOADED_AT = Date.now(); // the page as loaded: changes after this that couldn't apply live make it stale
// The editor's frame reloaded: what was stale before is on screen now
export const markLoaded = () => {
  LOADED_AT = Date.now();
  askedFiles.clear();
};
// Files written since the page loaded by changes the person asked for: the reload bar then says it is their change
// that is waiting, not some file
const askedFiles = new Set<string>();
// What needs a reload to show, and whether a change the person asked for is among it
export type Stale = { files: string[]; asked: boolean };
const SLOW_MS = 4000;
// The page is never reloaded at a moment the person didn't choose. The editor's own actions (Undo, a try, Use this
// one, a History restore) are a click that asks to see the result: when the page needs a reload to show it, it
// reloads at that click. A change that finishes some time after it was asked for doesn't reload anything: the bar
// over the page says the change is waiting and offers the button.
let ownActionAt = 0;
export const markOwnAction = () => {
  ownActionAt = Date.now();
};
const OWN_ACTION_MS = 6000;
let jobActivityAt = 0; // when a request was last seen running or finishing: what it wrote isn't the own action's doing
let reloadedFor = 0; // the file change (its time) the page was last reloaded for by itself

const post = async (url: string, body: object) => {
  const out = (await (
    await api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  ).json()) as { ok: boolean; error?: string };
  if (!out.ok) throw new Error(out.error ?? "The dev server said no");
};

export function useJobs(onSettled: (job: Job) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [max, setMax] = useState(3);
  // The card whose earlier state the page shows, and which try (0 = as it was before the change)
  const [comparing, setComparing] = useState<{ thread: string; upTo: number } | null>(null);
  const [stale, setStale] = useState<Stale | null>(null); // what changed since the page loaded that needs a reload to show
  const [mapAt, setMapAt] = useState(0); // when the dev server last changed the map (layers added, removed, back)
  const [settingFlags, setSettingFlags] = useState<Record<string, number>>({}); // layers whose settings moved or got lost
  const known = useRef(new Map<string, Job["state"]>());
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const refresh = useCallback(async () => {
    try {
      const d = (await (await api("/__inspector/jobs")).json()) as {
        jobs: Job[];
        max?: number;
        comparing?: { thread: string; upTo: number } | null;
        stale?: { at: number; files: string[] } | null;
        mapAt?: number;
        settingFlags?: Record<string, number>;
      };
      const landed: string[] = []; // files of the changes the person asked for that finished just now
      for (const j of d.jobs) {
        const was = known.current.get(j.id);
        if (was && active({ state: was } as Job) && !active(j)) {
          settled.current(j);
          if (j.state === "done") landed.push(...(j.files ?? []));
        }
        known.current.set(j.id, j.state);
      }
      setJobs(d.jobs);
      if (d.max) setMax(d.max);
      setComparing(d.comparing ?? null);
      // A reload is needed to show what changed (a script, a page's markup, code a hot update can't be trusted to
      // have reached). After the editor's own action the page reloads at once; otherwise the bar offers it, saying so
      // when it is the person's own change that waits.
      for (const f of landed) askedFiles.add(f);
      if (landed.length || d.jobs.some(active)) jobActivityAt = Date.now();
      const fresh = d.stale && d.stale.at > LOADED_AT && d.stale.at !== reloadedFor ? d.stale : null;
      // The own action's reload is for what that click wrote: not for a request that ran or finished after it
      const own = !!fresh && fresh.at >= ownActionAt && fresh.at - ownActionAt < OWN_ACTION_MS && jobActivityAt < ownActionAt;
      if (fresh && own) {
        ownActionAt = 0;
        reloadedFor = fresh.at; // until the page has loaded again, this one isn't asked for twice
        setStale(null);
        reloadInPlace();
      } else {
        const next = fresh ? { files: fresh.files, asked: fresh.files.some((f) => askedFiles.has(f)) } : null;
        setStale((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
      }
      setMapAt(d.mapAt ?? 0);
      setSettingFlags((was) => (JSON.stringify(was) === JSON.stringify(d.settingFlags ?? {}) ? was : (d.settingFlags ?? {})));
    } catch {
      /* the dev server is restarting (after a new package); the next poll catches up */
    }
  }, []);

  // The page's live-update script says a change needs a reload: ask right away rather than at the next poll
  useEffect(() => {
    const now = () => void refresh();
    window.addEventListener("design-inspector:stale", now);
    return () => window.removeEventListener("design-inspector:stale", now);
  }, [refresh]);

  const busy = jobs.some(active);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), busy ? FAST_MS : SLOW_MS);
    return () => clearInterval(id);
  }, [busy, refresh]);

  const act = useCallback(
    (url: string) => async (id: string) => {
      await post(url, { id });
      await refresh();
    },
    [refresh],
  );

  const call = useCallback(
    async (url: string, body: object) => {
      await post(url, body);
      await refresh();
    },
    [refresh],
  );
  const own = useCallback(
    async (url: string, body: object) => {
      markOwnAction();
      await call(url, body);
    },
    [call],
  );

  return {
    settingFlags,
    jobs, // newest first
    threads: threadsOf(jobs),
    max,
    comparing,
    stale,
    mapAt,
    refresh,
    stop: act("/__inspector/stop"),
    dismiss: (thread: string) => call("/__inspector/dismiss", { id: thread }),
    keep: (thread: string) => call("/__inspector/keep", { thread }),
    undo: (thread: string) => own("/__inspector/undo", { thread }),
    // Put a change that is out of the page back on the site as it is now
    bringBack: (thread: string) => own("/__inspector/bring-back", { thread }),
    // Show the page at one try (0 = before the change), or as it is now ("after")
    compare: (thread: string, upTo: number | "after") => own("/__inspector/compare", upTo === "after" ? { thread, side: "after" } : { thread, upTo }),
    // Go back to one try: later tries are taken back as one new version; the card stays for more refinements
    choose: (thread: string, upTo: number) => own("/__inspector/choose", { thread, upTo }),
    // A refinement of a card: the dev server sends the earlier tries as context and reuses the part, model and effort
    refine: (thread: string, request: string) =>
      call("/__inspector/run", { thread, request, mode: "part", part: "", prompt: "", model: "", effort: "" }),
  };
}

export type Jobs = ReturnType<typeof useJobs>;

// --- progress, shared by the cards and the part details

export const STEPS: { phase: Phase; label: string }[] = [
  { phase: "preparing", label: "Picking context" },
  { phase: "thinking", label: "Thinking" },
  { phase: "writing", label: "Writing" },
  { phase: "applying", label: "Applying" },
  { phase: "checking", label: "Checking" },
];

export const stepLabel = (j: Job) => {
  if (j.state === "queued") return "Waiting its turn";
  if (j.mode === "project") return j.log.at(-1)?.slice(0, 70) ?? "Working";
  const p = j.progress.phase;
  if (p === "fixing") return "Fixing a check error";
  if (p === "writing" && j.progress.written > 0) return `Writing · ~${k(Math.round(j.progress.written / 3.6))} tokens`;
  return STEPS.find((s) => s.phase === p)?.label ?? "Working";
};

// Seconds left: while it writes, from its writing speed and how long answers usually are; before that, from the
// estimate learned from past runs
export function secondsLeft(j: Job, now: number): number | null {
  const p = j.progress;
  if (j.state !== "running" || !j.eta) return null;
  if (p.phase === "writing" && p.writingSince && p.written > 300) {
    const rate = p.written / Math.max(1, (now - p.writingSince) / 1000);
    return Math.max(2, (j.eta.outputChars * 1.1 - p.written) / rate);
  }
  return j.eta.seconds - (now - j.started) / 1000;
}

// 0–1 for the progress bar: time spent over time expected, never quite full until it's done
export function fraction(j: Job, now: number): number {
  if (j.state === "done" || j.state === "error") return 1;
  if (j.state === "queued") return 0;
  const spent = (now - j.started) / 1000;
  const left = secondsLeft(j, now);
  if (left === null) return Math.min(0.9, spent / 60);
  return Math.min(0.94, Math.max(0.04, spent / Math.max(1, spent + Math.max(0, left))));
}

export const leftLabel = (j: Job, now: number) => {
  const left = secondsLeft(j, now);
  if (left === null) return "";
  if (left <= 0) return "longer than usual";
  return `about ${left < 60 ? `${Math.max(1, Math.round(left / 5) * 5)} s` : `${Math.round(left / 60)} min`} left`;
};

export const clock = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

// 950, 7.9k, 265k, 1.2M (no trailing .0)
const one = (n: number) => n.toFixed(1).replace(/\.0$/, "");
export const k = (n: number) => (n >= 1e9 ? `${one(n / 1e9)}B` : n >= 1e6 ? `${one(n / 1e6)}M` : n >= 1000 ? `${one(n / 1000)}k` : String(n));

// A ticking clock for progress (only while something runs)
export function useNow(running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  return now;
}
