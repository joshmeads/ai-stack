// A change and its tries (a thread): undo all of it, show the page before it and after it, go back to one try, keep it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { containsNow, git, readHistory, record, recordOutside, withWriteLock } from "./history.ts";
import { jobs } from "./jobs.ts";
import { designSnapshot, syncMap } from "./map-store.ts";
import { saveCards, threadOf } from "./queue.ts";
import { redoParamDefs, undoParamDefs, versionNo } from "./settings.ts";
import { exec, GIT_DIR, markStale, pnpm, ROOT, STATE, wroteOnPurpose } from "./site.ts";

// Take back a change (every try of its card) and keep the changes made after it: their edits reversed, as one new
// version. If a later change rewrote the same lines, that can't be done cleanly, and History is the way.
// The versions a card's tries made that are in the page now (see Entry.contains), newest first
export const shasOf = (thread: string, after = 0) => {
  const history = readHistory();
  const now = new Set(containsNow(history));
  const ids = new Set(threadOf(thread).filter((x) => x.try > after && x.entry && now.has(x.entry)).map((x) => x.entry as string));
  return history.filter((e) => ids.has(e.id) && (e.kind === "change" || e.kind === "direct")).reverse();
};
const without = (ids: Set<string>) => (before: string[]) => before.filter((id) => !ids.has(id));

export async function undoThread(thread: string) {
  return withWriteLock(async () => {
    const targets = shasOf(thread);
    const tries = threadOf(thread);
    if (!tries.length) throw new Error("That change's card is gone");
    if (!targets.length) throw new Error("Nothing of this change is left to undo");
    await recordOutside();
    const before = designSnapshot();
    const pkgFile = join(ROOT, "package.json");
    const readPkg = () => (existsSync(pkgFile) ? readFileSync(pkgFile, "utf8") : "");
    const pkg = readPkg();
    try {
      await git(["revert", "--no-commit", ...targets.map((e) => e.sha)]);
    } catch {
      await git(["revert", "--abort"]).catch(() => git(["reset", "--hard", "--quiet", "HEAD"]));
      throw new Error("A later change rewrote the same lines, so this one can't be taken back on its own. Use History to go back to the version before it.");
    }
    const first = tries[0];
    const layers = syncMap(before, []);
    const nums = targets.map((e) => versionNo(e.id));
    undoParamDefs(Math.min(...nums), Math.max(...nums));
    const entry = await record({ kind: "undo", partId: first.partId, label: `Undid ${first.part}: ${first.request.slice(0, 70)}` }, without(new Set(targets.map((e) => e.id))));
    saveCards();
    const reinstall = readPkg() !== pkg;
    if (reinstall) await pnpm(["install"]);
    return { entry, reinstalled: reinstall, layers };
  });
}

// Take back one edit the inspector wrote itself (typed words, a link, a slider): it has no card, so it's named by its
// version in History. Like Undo on a card: a new version that reverses it, keeping what came after.
export async function undoEdit(entryId: string) {
  return withWriteLock(async () => {
    const e = readHistory().find((x) => x.id === entryId);
    if (!e?.sha) throw new Error("That edit isn't in History any more");
    if (!containsNow().includes(e.id)) throw new Error("That edit was already taken back");
    await recordOutside();
    const before = designSnapshot();
    try {
      await git(["revert", "--no-commit", e.sha]);
    } catch {
      await git(["revert", "--abort"]).catch(() => git(["reset", "--hard", "--quiet", "HEAD"]));
      throw new Error("Something changed the same lines since, so this edit can't be taken back on its own. Use History to go back to the version before it.");
    }
    await git(["revert", "--quit"]).catch(() => "");
    syncMap(before, []);
    const n = versionNo(e.id);
    undoParamDefs(n, n);
    const entry = await record({ kind: "undo", partId: e.partId, label: `Undid ${e.label}`.slice(0, 100) }, without(new Set([e.id])));
    return { entry };
  });
}

// Before/After: the page shows the site without a change's tries (its edits reversed in the files, not recorded),
// then as it is again. Anything that writes (another change landing, a save) first switches back to "after".
// kept: what the inspector itself wrote into each of those files to show the "before" (a hash; "" for a file the
// "before" doesn't have), so an edit made outside the inspector meanwhile can be told from its own writing
export let comparing: { thread: string; upTo: number; files: string[]; kept?: Record<string, string> } | null = null;
export const compareFile = () => join(STATE, "compare.json");
export const compareBase = (f: string) => join(STATE, "compare-before", createHash("sha1").update(f).digest("hex"));
export const hashOf = (f: string) => (existsSync(join(ROOT, f)) ? createHash("sha1").update(readFileSync(join(ROOT, f))).digest("hex") : "");

export async function endCompare() {
  const c = comparing;
  if (!c) return;
  comparing = null;
  // A file of the comparison edited outside the inspector while the "before" was showing (in an editor, by another
  // tool): putting the "after" back over it would lose that edit without a word. Its edit is carried onto the "after"
  // when the two don't touch the same lines; when they do, the file is left as the person has it. Either way nothing
  // typed is lost, the version with the change is in History, and the change's card says what happened.
  const edited = c.kept ? c.files.filter((f) => hashOf(f) !== (c.kept as Record<string, string>)[f]) : [];
  const merged: string[] = [];
  const left: string[] = [];
  const inHead = new Set((await git(["ls-tree", "-r", "--name-only", "HEAD", "--", ...c.files])).split("\n").filter(Boolean));
  for (const f of edited) {
    const base = compareBase(f);
    if (!inHead.has(f) || !existsSync(join(ROOT, f)) || !existsSync(base)) {
      left.push(f); // the file exists on one side only: nothing to carry the edit onto
      continue;
    }
    const after = `${base}.after`;
    // The file as History has it, byte for byte (the git() helper trims its output, and a missing last line break
    // would read as an edit of the file's end)
    const head = await exec("git", ["show", `HEAD:${f}`], { env: { ...process.env, GIT_DIR, GIT_WORK_TREE: ROOT } });
    if (head.code !== 0) {
      left.push(f);
      continue;
    }
    writeFileSync(after, head.out);
    const r = await exec("git", ["merge-file", "-p", join(ROOT, f), base, after], { cwd: ROOT });
    if (r.code === 0) {
      writeFileSync(join(ROOT, f), r.out);
      merged.push(f);
    } else left.push(f);
  }
  const untouched = c.files.filter((f) => !edited.includes(f));
  const back = untouched.filter((f) => inHead.has(f));
  if (back.length) await git(["checkout", "HEAD", "--", ...back]);
  for (const f of untouched.filter((f) => !inHead.has(f))) {
    await git(["rm", "--cached", "--quiet", "--ignore-unmatch", "--", f]).catch(() => "");
    if (existsSync(join(ROOT, f))) unlinkSync(join(ROOT, f));
  }
  if (edited.length) {
    await git(["reset", "--quiet", "HEAD", "--", ...edited]).catch(() => ""); // the index as History has it; the files as the person has them
    const said = [
      merged.length && `${merged.join(", ")} was edited outside the studio while the page showed this change's "before": your edit was kept, on top of the change`,
      left.length && `${left.join(", ")} was edited outside the studio while the page showed this change's "before", on the lines this change touched: the file was left as you have it, so the change isn't in it now (it's in History)`,
    ].filter(Boolean).join(". ");
    threadOf(c.thread).at(-1)?.log.push(said);
    console.warn(`uberdesigner studio: ${said}`);
    markStale(edited);
  }
  wroteOnPurpose(c.files);
  rmSync(join(STATE, "compare-before"), { recursive: true, force: true });
  if (existsSync(compareFile())) unlinkSync(compareFile());
}

// upTo: the try whose result to show (0 = the part as it was before the change); later tries are reversed
export async function startCompare(thread: string, upTo: number) {
  await withWriteLock(async () => {
    const targets = shasOf(thread, upTo);
    if (!targets.length) return; // nothing after that try: the page already shows it
    await recordOutside();
    try {
      await git(["revert", "--no-commit", ...targets.map((e) => e.sha)]);
    } catch {
      await git(["revert", "--abort"]).catch(() => git(["reset", "--hard", "--quiet", "HEAD"]));
      throw new Error("A later change rewrote the same lines, so the page can't show this change's before on its own");
    }
    const files = (await git(["diff", "--name-only", "--cached", "HEAD"])).split("\n").filter(Boolean);
    await git(["revert", "--quit"]).catch(() => "");
    // What was just written to show the "before", file by file, to tell an outside edit from it later
    const kept: Record<string, string> = {};
    rmSync(join(STATE, "compare-before"), { recursive: true, force: true });
    mkdirSync(join(STATE, "compare-before"), { recursive: true });
    for (const f of files) {
      kept[f] = hashOf(f);
      if (kept[f]) writeFileSync(compareBase(f), readFileSync(join(ROOT, f)));
    }
    comparing = { thread, upTo, files, kept };
    wroteOnPurpose(files); // the page shows the "before" only once it runs that code
    writeFileSync(compareFile(), JSON.stringify(comparing) + "\n");
  });
}

// The dev server stopped while showing a "before": put the files back first
export async function recoverCompare() {
  try {
    if (!existsSync(compareFile())) return;
    comparing = JSON.parse(readFileSync(compareFile(), "utf8")) as { thread: string; upTo: number; files: string[]; kept?: Record<string, string> };
    await endCompare();
  } catch {
    /* nothing to recover */
  }
}

// Go back to one try: the tries after it are taken back as one new version and marked undone; the card stays, so the
// next refinement continues from that try
export async function chooseTry(thread: string, upTo: number) {
  return withWriteLock(async () => {
    const tries = threadOf(thread);
    const targets = shasOf(thread, upTo);
    if (!tries.length) throw new Error("That change's card is gone");
    if (tries.some((x) => x.state === "queued" || x.state === "running")) throw new Error("Wait for its current try to finish");
    if (!targets.length) return { entry: null };
    await recordOutside();
    const before = designSnapshot();
    try {
      await git(["revert", "--no-commit", ...targets.map((e) => e.sha)]);
    } catch {
      await git(["revert", "--abort"]).catch(() => git(["reset", "--hard", "--quiet", "HEAD"]));
      throw new Error("A later change rewrote the same lines, so the page can't go back to that try on its own. Use History instead.");
    }
    const first = tries[0];
    const layers = syncMap(before, []);
    const picked = targets.map((e) => versionNo(e.id));
    undoParamDefs(Math.min(...picked), Math.max(...picked));
    const entry = await record({ kind: "pick", partId: first.partId, label: `${first.part}: back to ${upTo ? `try ${upTo}` : "the original"} (${first.request.slice(0, 50)})` }, without(new Set(targets.map((e) => e.id))));
    saveCards();
    return { entry, layers };
  });
}

// Keep: the person has reviewed the change. The card stays, in the resolved list, and can still be undone.
export function keepThread(thread: string) {
  const tries = threadOf(thread);
  if (tries.some((x) => x.state === "queued" || x.state === "running")) throw new Error("Wait for its current try to finish");
  for (const x of tries) x.kept = true;
  saveCards();
}

// Bring back a change that was taken out (by Undo, "Use this one" or going back in History): its own edits put on
// the site as it is now, as one new version, with everything made since kept. If the same lines were rewritten since,
// that can't be done cleanly: nothing is touched, and asking for the change again is the way.
export async function bringBack(thread: string) {
  return withWriteLock(async () => {
    const tries = threadOf(thread);
    if (!tries.length) throw new Error("That change's card is gone");
    if (tries.some((x) => x.state === "queued" || x.state === "running")) throw new Error("Wait for its current try to finish");
    const history = readHistory();
    const now = new Set(containsNow(history));
    const out = new Set(tries.filter((x) => x.entry && !now.has(x.entry)).map((x) => x.entry as string));
    const targets = history.filter((e) => out.has(e.id) && e.kind === "change"); // oldest first
    if (!targets.length) throw new Error("This change is in the page already");
    await recordOutside();
    const before = designSnapshot();
    const pkgFile = join(ROOT, "package.json");
    const readPkg = () => (existsSync(pkgFile) ? readFileSync(pkgFile, "utf8") : "");
    const pkg = readPkg();
    try {
      await git(["cherry-pick", "--no-commit", ...targets.map((e) => e.sha)]);
    } catch {
      await git(["cherry-pick", "--abort"]).catch(() => git(["reset", "--hard", "--quiet", "HEAD"]));
      throw new Error("Later changes rewrote the same lines, so this change can't be put back as it was. Ask for it again in the field below: Claude makes it on the site as it is now.");
    }
    await git(["cherry-pick", "--quit"]).catch(() => "");
    const first = tries[0];
    const layers = syncMap(before, []);
    const nums = targets.map((e) => versionNo(e.id));
    redoParamDefs(Math.min(...nums), Math.max(...nums));
    const ids = targets.map((e) => e.id);
    const entry = await record({ kind: "redo", partId: first.partId, label: `Brought back ${first.part}: ${first.request.slice(0, 60)}` }, (held) => [...held.filter((id) => !ids.includes(id)), ...ids]);
    saveCards();
    const reinstall = readPkg() !== pkg;
    if (reinstall) await pnpm(["install"]);
    return { entry, reinstalled: reinstall, layers };
  });
}
