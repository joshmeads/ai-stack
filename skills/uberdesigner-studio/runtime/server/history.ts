// The site's history: a private git repository in .inspector/git (the project's own git, if any, is never touched),
// the list of versions, restore, and the lock that makes everything that writes the site's files take turns.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Entry, jobs } from "./jobs.ts";
import { designSnapshot, syncMap } from "./map-store.ts";
import { saveCards } from "./queue.ts";
import { checkSettings, logParamDefs, readSettings, restoreParamDefs, versionNo } from "./settings.ts";
import { DESIGN, exec, GIT_DIR, HISTORY, pnpm, ROOT, STATE, TOOL_PATHS, wroteOnPurpose } from "./site.ts";
import { comparing, endCompare } from "./threads.ts";

// Everything that writes the site's files (apply, check, fix, record; saves; undo) takes turns
export let writing: Promise<unknown> = Promise.resolve();
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  // Anything that writes first puts the page back to "after" if it's showing a change's "before"
  const run = async () => {
    if (comparing) await endCompare();
    return fn();
  };
  const turn = writing.then(run, run);
  writing = turn.catch(() => undefined);
  return turn;
}

export async function git(args: string[]): Promise<string> {
  const r = await exec("git", ["-c", "user.name=Inspector", "-c", "user.email=inspector@localhost", ...args], {
    env: { ...process.env, GIT_DIR, GIT_WORK_TREE: ROOT },
    timeout: 60000,
  });
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${(r.err || r.out).trim().slice(0, 300)}`);
  return r.out.trim();
}

export function readHistory(): Entry[] {
  try {
    return JSON.parse(readFileSync(HISTORY, "utf8")) as Entry[];
  } catch {
    return [];
  }
}

export const writeHistory = (h: Entry[]) => writeFileSync(HISTORY, JSON.stringify(h, null, 2) + "\n");

// --- What is in the page (see Entry.contains)

const isChange = (e: Entry) => e.kind === "change" || e.kind === "direct";
// The list of a version. One from before versions carried it is worked out the old way: every change up to it that
// no version up to it took back.
export function containsAt(history: Entry[], e: Entry): string[] {
  if (e.contains) return e.contains;
  const upTo = versionNo(e.id);
  return history.filter((x) => isChange(x) && versionNo(x.id) <= upTo && !(x.undoneBy && versionNo(x.undoneBy) <= upTo)).map((x) => x.id);
}
export function containsNow(history = readHistory()): string[] {
  const last = history[history.length - 1];
  if (!last) return [];
  if (last.contains) return last.contains;
  // The newest version of an older history: its list is written down once. Cards a restore settled the old way
  // (a flag on the card only) are left out.
  const settled = new Set(jobs.filter((x) => x.undone && x.entry).map((x) => x.entry as string));
  last.contains = containsAt(history, last).filter((id) => !settled.has(id));
  writeHistory(history);
  return last.contains;
}
// A job as the panel gets it: "undone" says whether the change it made is out of the page now
export function withState<T extends { entry?: string; undone?: boolean }>(list: T[]): T[] {
  const now = new Set(containsNow());
  return list.map((x) => (x.entry ? { ...x, undone: !now.has(x.entry) } : x));
}
// History as the panel gets it: each change says whether it is in the page now, and each version why it is a point
export function historyView(): (Entry & { undone?: boolean })[] {
  const history = readHistory();
  const now = new Set(containsNow(history));
  return history.map((e) => ({ ...e, contains: undefined, undone: isChange(e) ? !now.has(e.id) : undefined, point: pointOf(e) }));
}

// --- Points: the versions History lists to go back to. Every save is one, and the starting point. The rest are
// marked on the version that was current at a moment worth returning to: where a work session started, before a
// whole-site change, before going back in History, and every STEPS versions when none of those came up.
const PAUSE_MS = 30 * 60 * 1000; // no version for this long: the next change starts a new session
const STEPS = 10;
let sessionOpen = false;
export const pointOf = (e: Entry): string | undefined => e.point ?? (e.kind === "start" ? "Starting point" : e.kind === "save" ? "Saved" : undefined);
export function markPoint(why: string) {
  const history = readHistory();
  const last = history[history.length - 1];
  if (!last || pointOf(last)) return;
  last.point = why;
  writeHistory(history);
}

export const EXCLUDE = ["node_modules/", "dist/", ".inspector/", ".DS_Store", "*.log", ...TOOL_PATHS.map((p) => `/${p}`)].join("\n") + "\n";

// The history is this server's alone: nothing else writes it. A lock a stopped server left behind (the dev server
// killed while a version was being written, which on a site with gigabytes of media takes most of a minute) would
// refuse every write from then on, so it is cleared when the server starts, before anything of its own runs.
export function clearStaleLock() {
  for (const f of ["index.lock", "HEAD.lock"]) {
    try {
      unlinkSync(join(GIT_DIR, f));
    } catch {
      /* none */
    }
  }
}

export async function ensureHistory() {
  // A history that was begun and never got its starting point (stopped mid-way) is begun again
  if (existsSync(join(GIT_DIR, "HEAD")) && readHistory().length) {
    // Histories started before the tool's files were left out: stop tracking them (once)
    writeFileSync(join(GIT_DIR, "info", "exclude"), EXCLUDE);
    if (await git(["ls-files", "--", ...TOOL_PATHS])) {
      await git(["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ...TOOL_PATHS]);
      await git(["commit", "--quiet", "-m", "Leave the studio's own files out of history"]);
    }
    return;
  }
  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, ".gitignore"), "*\n"); // keep the history out of any repository the project lives in
  if (!existsSync(join(GIT_DIR, "HEAD"))) await git(["init", "--quiet"]);
  writeFileSync(join(GIT_DIR, "info", "exclude"), EXCLUDE);
  await git(["add", "-A"]);
  await git(["commit", "--quiet", "--allow-empty", "-m", "Starting point"]);
  writeHistory([{ id: "v1", sha: await git(["rev-parse", "HEAD"]), time: new Date().toISOString(), kind: "start", label: "Starting point", files: [], contains: [] }]);
  // Settings whose numbers changed since the editor first read them were changed outside it (history starts only now)
  logParamDefs("v1");
  if (readSettings()) checkSettings("outside", "an edit made outside the studio");
}

// Commit whatever changed as a new version; null when nothing changed. `contains` says what the new version holds,
// given what the one before held (a change adds itself by default; everything else leaves the list as it was). When
// the files didn't change but the list does (taking back a change whose edits are already gone), the newest version's
// list is corrected in place.
type Holds = (before: string[], id: string) => string[];
export async function record(fields: Omit<Entry, "id" | "sha" | "time" | "files" | "contains" | "point">, contains?: Holds): Promise<Entry | null> {
  await ensureHistory();
  await git(["add", "-A"]);
  const history = readHistory();
  const before = containsNow(history);
  if (!(await git(["status", "--porcelain"]))) {
    const last = history[history.length - 1];
    if (contains && last) {
      last.contains = contains(before, last.id);
      writeHistory(history);
    }
    return null;
  }
  // The first version of a work session (or after a long pause): where things stood is a point to come back to
  const last = history[history.length - 1];
  if (fields.kind !== "outside" && last && !pointOf(last) && (!sessionOpen || Date.now() - Date.parse(last.time) > PAUSE_MS)) last.point = "Where the session started";
  if (fields.kind !== "outside") sessionOpen = true;
  await git(["commit", "--quiet", "-m", fields.label]);
  const id = `v${history.length + 1}`;
  const entry: Entry = {
    ...fields,
    id,
    sha: await git(["rev-parse", "HEAD"]),
    time: new Date().toISOString(),
    files: (await git(["diff", "--name-only", "HEAD~1", "HEAD"])).split("\n").filter(Boolean),
    contains: contains ? contains(before, id) : fields.kind === "change" || fields.kind === "direct" ? [...before, id] : before,
  };
  // A long run of versions with no point in it gets one, so there is always something near to go back to
  const sincePoint = [...history].reverse().findIndex((e) => pointOf(e));
  if (!pointOf(entry) && sincePoint >= STEPS - 1) entry.point = `${STEPS} changes later`;
  writeHistory([...history, entry]);
  // Words and values the inspector typed are on the page already; edits by other hands are the dev server's to show
  if (entry.kind === "change" || entry.kind === "undo" || entry.kind === "redo" || entry.kind === "pick" || entry.kind === "restore") wroteOnPurpose(entry.files);
  try {
    logParamDefs(entry.id);
    checkSettings(entry.kind, entry.label);
  } catch {
    /* a map being rewritten: checked at the next version */
  }
  return entry;
}

// Edits made in an editor or elsewhere become their own version first, so a restore can bring them back too
export const recordOutside = () => record({ kind: "outside", label: "Changes made outside the studio" });

// Versions from before the inspector moved into .inspector/tool can carry its old mount line; drop it on restore
export function cleanLegacyWiring() {
  for (const f of ["src/main.tsx", "src/main.ts", "src/main.jsx"]) {
    const abs = join(ROOT, f);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    const next = text.replace(/\n*\/\/ The design inspector[^\n]*\n[^\n]*inspector\/mount[^\n]*\n?/g, "\n").replace(/\n[^\n]*import\("\.\/inspector\/mount"\)[^\n]*/g, "");
    if (next !== text) writeFileSync(abs, next.trimEnd() + "\n");
  }
}

export async function restore(id: string) {
  const target = readHistory().find((e) => e.id === id);
  if (!target) throw new Error(`No version ${id}`);
  await recordOutside();
  markPoint(`Before going back to ${target.id}`); // so going back can itself be taken back
  const before = designSnapshot();
  const pkgFile = join(ROOT, "package.json");
  const readPkg = () => (existsSync(pkgFile) ? readFileSync(pkgFile, "utf8") : "");
  const pkg = readPkg();
  // Bring back the design as it was (changed and deleted files), then remove files added since; the tool's own files
  // are left alone either way
  await git(["checkout", target.sha, "--", ...DESIGN]);
  const added = await git(["diff", "--name-only", "--no-renames", "--diff-filter=A", target.sha, "HEAD", "--", ...DESIGN]);
  for (const f of added.split("\n").filter(Boolean)) {
    const abs = resolve(ROOT, f);
    if (abs.startsWith(ROOT + "/") && existsSync(abs)) unlinkSync(abs);
  }
  cleanLegacyWiring();
  const layers = syncMap(before, []);
  restoreParamDefs(versionNo(target.id));
  // The page holds what the version gone back to held: cards and History read their state from that list
  const held = containsAt(readHistory(), target);
  const entry = await record({ kind: "restore", label: `Back to ${target.id}: ${target.label}` }, () => held);
  saveCards();
  const reinstall = readPkg() !== pkg;
  if (reinstall) await pnpm(["install"]);
  return { entry, reinstalled: reinstall, layers };
}
