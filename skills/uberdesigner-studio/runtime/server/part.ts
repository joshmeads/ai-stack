// A change to one part, start to finish: what is sent (the part's context and values), the call, the answer applied,
// the check (typecheck or script parse) with one fix call, the map kept in step, and the version recorded.

import { scriptsIn } from "./script-check.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addressNote } from "./address.ts";
import { readNumber } from "./direct.ts";
import { type PageFacts, render, resolveContext, sentChars, type Source } from "./slices.ts";
import { motionFile } from "./motion.ts";
import { cssOfFile, rootTokens } from "./reconcile.ts";
import { applyAnswer, PACKAGE, type ParamEntry } from "./answer.ts";
import { cssIntact } from "./css-write.ts";
import { addUsage, askPart } from "./claude.ts";
import { clean } from "./direct-changes.ts";
import { learn, predict } from "./estimates.ts";
import { readHistory, record, recordOutside, withWriteLock } from "./history.ts";
import type { Job, RunRequest } from "./jobs.ts";
import { addParams, designSnapshot, syncMap, updateMap } from "./map-store.ts";
import { type DesignMap, EDITABLE, editableFiles, exec, hasPackage, hasTsconfig, type MapPart, pnpm, readMap, readSite, ROOT, strip, view } from "./site.ts";

export const fileBlock = (f: string) => `<file path="${f}">\n${strip(f, readFileSync(resolve(ROOT, f), "utf8"))}\n</file>`;

// A stylesheet the change left with a rule open (a brace, a comment or a quote that never closes): everything after
// it is swallowed, and neither the typecheck nor a script parse would say so. Checked on the touched .css files and
// the <style> blocks of touched pages, against how they were before.
export function cssErrors(files: string[], before: Map<string, string>): string {
  return files
    .filter((f) => /\.(css|html?)$/.test(f) && existsSync(join(ROOT, f)))
    .filter((f) => !cssIntact(f, before.get(f) ?? "", view(f)))
    .map((f) => `${f}: the CSS no longer closes what it opens (a "{", a comment or a quote is left open), so the rules after that point are lost. Close it.`)
    .join("\n");
}

// Errors the change introduced, in the given files only (errors elsewhere were there before and aren't this change's
// to fix). TypeScript projects: the typecheck. Sites with no build step: a syntax check of every script in the touched
// files (inline <script> blocks in HTML, and .js files).
export async function typeErrors(files: string[]): Promise<string> {
  if (!hasTsconfig()) return scriptErrors(files);
  const r = await pnpm(["exec", "tsc", "--noEmit", "-p", "."]);
  if (r.code === 0) return "";
  return (r.out + r.err)
    .split("\n")
    .filter((l) => files.some((f) => l.startsWith(f)))
    .join("\n");
}

export async function scriptErrors(files: string[]): Promise<string> {
  const out: string[] = [];
  const dir = join(tmpdir(), "design-inspector", "check");
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8");
    for (const s of scriptsIn(f, text)) {
      const tmp = join(dir, `check-${Date.now()}.${s.module ? "mjs" : "cjs"}`);
      writeFileSync(tmp, s.code);
      const r = await exec(process.execPath, ["--check", tmp], { timeout: 15000 });
      if (r.code !== 0) out.push(`${s.name}: ${(r.err.split("\n").find((l) => /Error/.test(l)) ?? r.err).trim()}`);
    }
  }
  return out.join("\n");
}

// The part's tunable values, for the request: the tokens its rules use (label = value) and its effect settings (where
// they live and their number now), so a change moves those instead of adding constants or literals beside them
export function tunableValues(partId: string | undefined, sources: Source[] = []): string {
  if (!partId) return "";
  const map = readMap() as DesignMap & { tokens?: Record<string, { label?: string }> };
  const part = map.parts?.find((p) => p.id === partId) as (MapPart & { params?: ParamEntry[] }) | undefined;
  if (!part) return "";
  const defs = map.tokensFile && existsSync(join(ROOT, map.tokensFile)) ? rootTokens(cssOfFile(map.tokensFile, view(map.tokensFile))) : new Map<string, string>();
  const lines: string[] = [];
  for (const t of part.tokens) lines.push(`- ${t}${map.tokens?.[t]?.label ? ` (${map.tokens[t].label})` : ""} = ${defs.get(t) ?? "?"}`);
  for (const q of part.params ?? []) {
    const text = readSite(q.file);
    const n = text !== null ? readNumber(text, q) : null;
    lines.push(`- ${q.label}: the number after \`${(q.find ?? q.name ?? "").slice(0, 60)}\` in ${q.file} = ${n ?? "?"}`);
  }
  // Other layers' values anchored in the code this change gets (a whole file, or inside one of its slices): only an
  // edit there can move them, so Claude sees those and returns corrected entries (same label) when it does
  const anchoredInSent = (q: ParamEntry) => {
    const src = sources.find((x) => x.file === clean(q.file));
    if (!src) return false;
    if (src.whole) return true;
    const at = view(src.file).indexOf(q.find ?? `${q.name} =`);
    return at >= 0 && src.ranges.some((r) => at >= r.start && at < r.end);
  };
  const others: string[] = [];
  for (const other of map.parts ?? []) {
    if (other.id === partId) continue;
    for (const q of ((other as MapPart & { params?: ParamEntry[] }).params ?? []).filter(anchoredInSent)) {
      const text = readSite(clean(q.file));
      const n = text !== null ? readNumber(text, q) : null;
      if (others.length < 60) others.push(`- ${q.label} (layer ${other.id}): the number${q.nth ? ` #${q.nth + 1}` : ""} after \`${(q.find ?? q.name ?? "").slice(0, 60)}\` in ${clean(q.file)} = ${n ?? "?"}`);
    }
  }
  const own = lines.length ? `\n\nIts tunable values (change these rather than adding constants or literals beside them):\n${lines.join("\n")}` : "";
  const near = others.length
    ? `\n\nOther layers' tunable values in these files (leave them unless the request is about them; if your edits move the text before one of these numbers or put another number there, return its corrected entry in "map.params" with the same label):\n${others.join("\n")}`
    : "";
  return own + near;
}

// What a part change sends: the files picked by hand (whole), or the part's automatic context
// The rules the panel listed, by the site file each one's stylesheet is (motion.ts knows how a stylesheet seen on the
// page maps back to a file); rules of stylesheets that aren't the site's own editable files are left out
function pageFacts(page: RunRequest["page"]): PageFacts | undefined {
  if (!page?.rules?.length) return undefined;
  const by: PageFacts = new Map();
  for (const r of page.rules.slice(0, 300)) {
    if (typeof r?.source !== "string" || typeof r.selector !== "string" || typeof r.nth !== "number") continue;
    const file = motionFile(r.source);
    if (file) by.set(file, [...(by.get(file) ?? []), { selector: r.selector.slice(0, 400), nth: r.nth, around: !!r.around }]);
  }
  return by.size ? by : undefined;
}

export function contextFor(r: { partId?: string; files?: string[]; alsoFiles?: string[]; request: string; page?: RunRequest["page"] }): Source[] {
  if (r.files?.length) return r.files.map((f) => ({ file: f, whole: true, ranges: [], reason: "picked by you" }));
  const map = readMap();
  const part = map.parts?.find((p) => p.id === r.partId);
  if (!part) throw new Error(`No part "${r.partId}" in the map`);
  const auto = resolveContext(part, r.request, map, editableFiles(), view, pageFacts(r.page));
  const also = (r.alsoFiles ?? []).filter((f) => EDITABLE.test(f) && existsSync(join(ROOT, f)));
  return [...auto.filter((x) => !also.includes(x.file)), ...also.map((f) => ({ file: f, whole: true, ranges: [], reason: "approved by you" }))];
}

export const describeContext = (sources: Source[]) =>
  sources.map((s) => ({
    file: s.file,
    note: s.whole ? s.reason : `${s.ranges.length} slice${s.ranges.length > 1 ? "s" : ""}: ${s.ranges.map((x) => x.note.replace(/^(markup|CSS|function) /, "$1 ")).slice(0, 4).join(", ")}${s.ranges.length > 4 ? ", …" : ""}`,
    chars: s.whole ? view(s.file).length : s.ranges.reduce((n, x) => n + x.end - x.start, 0),
  }));

// The rule for whole files: nothing above about 20k tokens goes to Claude unless the person said yes to it. What a part
// change sends by itself is shown before it's sent (the estimate under the request); what Claude asks for afterwards
// (another file whole) and the fix call after a failed check are held to this.
export const CHARS_PER_TOKEN = 3.6;
export const ASK_ABOVE_CHARS = 20_000 * CHARS_PER_TOKEN;

export const SLICES_NOTE = `Some files are sent as slices (<file view="slices">): only the pieces of a big file that belong to this part, with their line numbers. Copy each "find" from inside a slice; never from memory of the rest of the file. If you need code that isn't in the slices, return no edits and put that file in needs.files: it will be sent whole.`;

// An answer whose edits no longer fit because another change landed in the same file meanwhile
export class Conflict extends Error {}

export async function runPart(j: Job, r: RunRequest, retry = false): Promise<void> {
  j.progress = { phase: "preparing", written: 0, lastAt: Date.now() };
  let sent = contextFor(r);
  if (!sent.length) throw new Error("Nothing to send for this part: pick files by hand");
  const packages = (r.packages ?? []).filter((p) => PACKAGE.test(p));
  const approved =
    packages.length || r.allowNew
      ? `\n\nApproved by the user for this change:${packages.length ? `\n- packages (installed before your edits are applied): ${packages.join(", ")}` : ""}${r.allowNew ? "\n- new files" : ""}`
      : "";
  const earlier = r.previous
    ? `\n\nThis continues earlier tries of the same change (their edits are already in the files below). The person looked at the result and is asking for more:\n${r.previous}`
    : "";
  const inside = (readMap().parts ?? []).filter((p) => (p as MapPart & { parent?: string }).parent === r.partId && !(p as MapPart & { removed?: boolean }).removed).map((p) => `${p.id} (${p.label})`);
  const ids = r.partId ? ` (id ${r.partId}${inside.length ? `; the parts inside it: ${inside.join(", ")}` : ""})` : "";
  // A part found on the page by a selector, not by a tag in the code: one line saying which element it is
  const mapParts = readMap().parts ?? [];
  const own = mapParts.find((p) => p.id === r.partId);
  const where = own ? addressNote(own, (id) => mapParts.find((p) => p.id === id)?.label) : "";
  // Worked out for each call: a follow-up that sends more files lists the values anchored in those files too
  const build = () =>
    `Part: ${r.part}${ids}${where ? `\n${where}` : ""}\n\nWhat the build prompt says about this part:\n${r.prompt}${tunableValues(r.partId, sent)}${earlier}\n\nChange request:\n${r.request.trim()}${approved}\n\n${sent.some((x) => !x.whole) ? SLICES_NOTE + "\n\n" : ""}What you may change:\n\n${render(sent, view)}`;
  // The files as they were when sent: if one has changed by the time the answer is applied, another change landed
  let snapshot = new Map<string, string>();
  const say = () => {
    j.context = describeContext(sent);
    snapshot = new Map(sent.map((x) => [x.file, view(x.file)]));
    const chars = sentChars(sent, view);
    j.log.push(`Sending ${sent.map((x) => (x.whole ? x.file : `${x.file} (${x.ranges.length} slices)`)).join(", ")} · ~${Math.round(chars / 3600 * 10) / 10}k tokens`);
    return chars;
  };
  const chars = say();
  j.eta = predict(r.model, "part", chars);

  let first = await askPart(build(), r, j);
  j.usage = addUsage(j.usage, first.usage);
  // Claude asked for more of the site's own files (no packages, no new files): send them and ask again, once
  const more = first.answer.needs;
  if (!first.answer.edits.length && !first.answer.create.length && more && !more.packages.length && !more.newFiles.length && more.files.length) {
    const extra = more.files.filter((f) => EDITABLE.test(f) && existsSync(join(ROOT, f)));
    const wider: Source[] = [...sent.filter((x) => !extra.includes(x.file)), ...extra.map((f) => ({ file: f, whole: true, ranges: [], reason: "Claude asked for it" }))];
    const widerChars = sentChars(wider, view);
    if (extra.length && widerChars > ASK_ABOVE_CHARS) {
      // A big file is never sent whole unasked: the card lists what Claude asked for with its size, and the person
      // allows it or doesn't (the "needs" path below)
      const size = (f: string) => `${f} (~${Math.round(view(f).length / CHARS_PER_TOKEN / 1000)}k tokens)`;
      j.log.push(`Claude asked for ${extra.map(size).join(", ")} whole. That makes the request ~${Math.round(widerChars / CHARS_PER_TOKEN / 1000)}k tokens, so it wasn't sent: waiting for your OK`);
      more.why = `${more.why ? `${more.why} ` : ""}Sending ${extra.length > 1 ? "these files" : "this file"} whole makes the request about ${Math.round(widerChars / CHARS_PER_TOKEN / 1000)}k tokens, so the studio asks first. For a change this wide, Whole site may cost less.`;
    } else if (extra.length) {
      sent = wider;
      j.log.push(`Claude asked for ${extra.join(", ")}: sending ${extra.length > 1 ? "them" : "it"} whole`);
      say();
      j.progress = { phase: "thinking", written: 0, lastAt: Date.now() };
      first = await askPart(build(), r, j);
      j.usage = addUsage(j.usage, first.usage);
    }
  }
  j.summary = first.answer.summary;
  const { answer } = first;
  if (!answer.edits.length && !answer.create.length) {
    if (answer.needs) {
      j.needs = answer.needs;
      j.log.push("Needs more than these files: waiting for your OK");
    }
    learn(r.model, "part", chars, j);
    return;
  }

  j.progress.phase = "applying"; // changes apply one at a time: this may wait for another to finish applying
  try {
    await withWriteLock(async () => {
      if (j.stopped) throw new Error("Stopped. Nothing was changed.");
      await recordOutside();
      if (packages.length && !hasPackage()) throw new Error("This site has no package.json, so packages can't be installed: ask for a CDN script instead");
      if (packages.length) {
        j.log.push(`Installing ${packages.join(", ")}`);
        const install = await pnpm(["add", ...packages]);
        if (install.code !== 0) throw new Error(`pnpm add failed: ${(install.err || install.out).trim().slice(-300)}`);
      }
      // Slices point into the files as they were sent; a file another change has touched since is matched as a whole
      const unchanged = sent.filter((x) => existsSync(join(ROOT, x.file)) && view(x.file) === snapshot.get(x.file));
      const moved = sent.filter((x) => !unchanged.includes(x)).map((x) => x.file);
      const before = designSnapshot(sent.map((x) => x.file));
      let touched: string[];
      try {
        touched = applyAnswer(answer, sent.map((x) => x.file), !!r.allowNew, unchanged);
      } catch (err) {
        if (moved.length && !retry) throw new Conflict(`${moved.join(", ")} changed while Claude was writing`);
        throw err;
      }
      j.log.push(`Applied ${answer.edits.length} edit${answer.edits.length === 1 ? "" : "s"}${answer.create.length ? `, created ${answer.create.map((c) => c.file).join(", ")}` : ""}`);
      if (answer.map && r.partId) {
        const said = updateMap(answer.map, r.partId, touched, j.request);
        if (said) {
          j.log.push(said);
          j.mapChanged = true;
        }
        // The layers it added, for the panel to look for on the page once the change is on it
        const now = readMap().parts ?? [];
        const added = answer.map.add.map((a) => a.id).filter((id) => now.some((p) => p.id === id && !(p as MapPart & { removed?: boolean }).removed));
        if (added.length) j.added = added;
      }
      const kept = [...syncMap(before, touched, { request: j.request, described: answer.map?.tokens, focus: r.partId ? [r.partId] : [] }), addParams(r.partId, answer.map?.params ?? [])].filter(Boolean);
      if (kept.length) {
        j.log.push(`Layers kept in step: ${kept.join("; ")}`);
        j.mapChanged = true;
      }
      learn(r.model, "part", chars, j);
      try {
        // Free check: the typecheck, or a syntax check of the scripts. Only if it fails does Claude get one more call.
        j.progress.phase = "checking";
        j.log.push(hasTsconfig() ? "Typechecking" : "Checking the scripts");
        const check = async () => [await typeErrors(touched), cssErrors(touched, before)].filter(Boolean).join("\n");
        const errors = await check();
        const fixChars = touched.reduce((n, f) => n + view(f).length, 0);
        if (errors && fixChars > ASK_ABOVE_CHARS) {
          // The fix call sends the touched files whole: too big to send unasked
          j.log.push(`Check failed. A fix call would send the changed files whole (~${Math.round(fixChars / CHARS_PER_TOKEN / 1000)}k tokens), so it wasn't made`);
          j.summary = `${answer.summary} The check reports errors, and fixing them automatically would send ~${Math.round(fixChars / CHARS_PER_TOKEN / 1000)}k tokens: reply to this change to have it fixed, or undo. ${errors.split("\n")[0]}`;
        } else if (errors) {
          j.log.push("Check failed: one fix call with the errors");
          j.progress = { ...j.progress, phase: "fixing", written: 0, lastAt: Date.now() };
          const fixPrompt = `Part: ${r.part}\n\nYou just made this change: ${answer.summary}\nIt was applied, but the check reports:\n${errors.slice(0, 4000)}\n\nFix these errors with the smallest edits. What you may change:\n\n${touched.map((f) => `<file path="${f}">\n${view(f)}\n</file>`).join("\n\n")}`;
          const fix = await askPart(fixPrompt, r, j);
          j.usage = addUsage(j.usage, fix.usage);
          applyAnswer({ ...fix.answer, create: [] }, touched, false);
          j.progress.phase = "checking";
          const left = await check();
          j.log.push(left ? "Still failing after the fix" : "Passes after the fix");
          if (left) j.summary = `${answer.summary} The check still reports errors: reply with what you see, or undo. ${left.split("\n")[0]}`;
        } else j.log.push(`${hasTsconfig() ? "Typecheck passed" : "Scripts parse"}${touched.some((f) => /\.(css|html?)$/.test(f)) ? ", the CSS is whole" : ""}`);
      } catch (err) {
        // What was applied is still recorded now, so no other change's version picks it up
        j.error = err instanceof Error ? err.message : String(err);
        await commit(j, r, true);
        throw err;
      }
      await commit(j, r);
    });
  } catch (err) {
    if (!(err instanceof Conflict)) throw err;
    j.log.push(`${err.message}: asking again with the current file`);
    j.retried = true;
    return runPart(j, { ...r, previous: undefined }, true);
  }
}

// A change's result becomes a version (nothing is recorded when it changed nothing)
export async function commit(j: Job, r: RunRequest, failed = false, kind: "change" | "direct" = "change") {
  const before = readHistory().at(-1)?.id;
  const entry = await record({
    kind,
    mode: r.mode,
    partId: r.partId,
    label: failed ? `${r.part} (stopped): ${j.request.slice(0, 70)}` : `${r.part}: ${j.request.slice(0, 80)}`,
    request: j.request,
    summary: failed ? j.error : j.summary,
    usage: j.usage,
  });
  if (!entry) return void (j.files ??= []);
  j.before = before;
  j.files = entry.files;
  j.entry = entry.id;
}
