// Changes the inspector writes itself, with no Claude call, when it can be sure where they go: words typed over the
// page, a link's address, an image swapped for a file, an effect's number. Anything less certain goes to Claude as an
// ordinary change of the part.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findString, searchFiles, setNumber } from "./direct.ts";
import { account } from "./savings.ts";
import { applySwaps, findText, type TextChange } from "./text.ts";
import { recordOutside, withWriteLock } from "./history.ts";
import type { Job } from "./jobs.ts";
import { commit, contextFor } from "./part.ts";
import { startRun } from "./queue.ts";
import { sentChars } from "./slices.ts";
import { type MapPart, readMap, readSite, ROOT, safePath, view } from "./site.ts";

// --- Text typed over the page (text.ts finds where it lives)

// Files the inspector itself just wrote for a text edit: the page already shows those words, so the live-update side
// (serve.ts, vite-plugin.ts) doesn't ask for a reload because of them
export const ownWrites = new Map<string, number>();
export const isOwnWrite = (file: string) => Date.now() - (ownWrites.get(file.replace(/^\/+/, "")) ?? 0) < 4000;

// claude: the person asked for Claude to make it, after being told it can't be written directly
export type TextRequest = { partId: string; changes: TextChange[]; whole: TextChange; structural?: boolean; model: string; effort: string; claude?: boolean };
// What a direct edit answers. Written: no card, its version in History (entry) so it can be taken back. Not written:
// why, and what asking Claude would cost; nothing is sent unless the person then asks (claude: true).
export type DirectResult = { direct: true; entry?: string; summary: string } | { direct: false; why: string; tokens: number; job?: Job };
const askCost = (partId: string, request: string) => {
  try {
    return Math.round(sentChars(contextFor({ partId, request }), view) / 3.6) + 3000;
  } catch {
    return 0;
  }
};
export const quote = (s: string, n = 48) => {
  const t = s.replace(/\s+/g, " ").trim();
  return `“${t.length > n ? t.slice(0, n - 1) + "…" : t}”`;
};

export async function editText(t: TextRequest): Promise<DirectResult> {
  const map = readMap();
  const part = map.parts?.find((p) => p.id === t.partId);
  if (!part) throw new Error("Pick text inside one of the site's parts");
  if (t.whole.from === t.whole.to) throw new Error("Nothing changed");
  const read = (f: string) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : null);
  // The card shows a short quote; Claude always gets the full texts (a cut-down quote ended up in a file, "…" and all)
  const request = `Change the text ${quote(t.whole.from, 200)} to ${quote(t.whole.to, 200)}`;
  const exact = `Change this text:\n<from>\n${t.whole.from}\n</from>\nto exactly this text:\n<to>\n${t.whole.to}\n</to>`;
  let why = "";
  const direct = await withWriteLock(async () => {
    const found = t.structural ? ({ ok: false, why: "the formatting inside the text changed" } as const) : findText(part, map, t.changes, read);
    if (!found.ok) {
      why = found.why;
      return null;
    }
    const next = applySwaps(found.swaps, read);
    // The version before this edit first (on a site with no history yet, that's the starting point), so the edit
    // becomes its own version and Undo or a restore can take it back
    await recordOutside();
    for (const [file, text] of next) {
      ownWrites.set(file, Date.now());
      writeFileSync(safePath(file), text);
    }
    const now = Date.now();
    const id = `job-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const j: Job = {
      id,
      thread: id,
      try: 1,
      model: t.model,
      effort: t.effort,
      mode: "part",
      part: part.label,
      request,
      state: "done",
      queuedAt: now,
      started: now,
      finished: now,
      log: [],
      summary: `Changed the words directly in ${[...next.keys()].join(", ")}, with no Claude call.`,
      usage: { input: 0, output: 0, costUsd: 0, seconds: 0, turns: 0 },
      progress: { phase: "applying", written: 0, lastAt: now },
      partId: part.id,
      direct: true,
    };
    // An edit the inspector wrote itself is not a change to review: no card. It is a version in History.
    await commit(j, { mode: "part", part: part.label, partId: part.id, prompt: "", request, model: t.model, effort: t.effort }, false, "direct");
    account(ROOT, j);
    return j;
  });
  if (direct) return { direct: true, entry: direct.entry, summary: direct.summary ?? "" };
  // Not sure where the words live. Nothing is sent by itself: the person is told why, and may ask Claude for it
  if (!t.claude) return { direct: false, why, tokens: askCost(part.id, request) };
  const job = startRun({
    mode: "part",
    part: part.label,
    partId: part.id,
    prompt: [...part.prompt.map((x) => `${x.where}: ${x.text}`), ...(part.note ? [part.note] : [])].join("\n"),
    request: `${exact}\nChange only those words, wherever this part shows them (a phone copy too); keep the markup and styling around them. (The studio couldn't do it directly: ${why}; they may be made by the page's code or split up for an animation.)`,
    model: t.model,
    effort: t.effort,
  });
  return { direct: false, job, why, tokens: 0 };
}

// --- Other direct changes (direct.ts): a link's address, an image swapped for one from the computer, an effect's number.
// Each is written straight into the file when its place is certain: no card, a version in History. Otherwise nothing
// is written or sent: the answer says why, and Claude makes it as an ordinary change of the part only if the person
// then asks (claude: true).

export type DirectRequest = { partId: string; model: string; effort: string; claude?: boolean };
export const partOf = (id: string) => {
  const part = readMap().parts?.find((p) => p.id === id);
  if (!part) throw new Error("Pick one of the site's parts first");
  return part;
};
export const promptOf = (part: MapPart) => [...part.prompt.map((x) => `${x.where}: ${x.text}`), ...(part.note ? [part.note] : [])].join("\n");

export async function directOrClaude(
  d: DirectRequest,
  request: string,
  write: () => { files: Map<string, string>; summary: string } | { why: string },
  claudeRequest: (why: string) => string,
): Promise<DirectResult> {
  const part = partOf(d.partId);
  let why = "";
  const direct = await withWriteLock(async () => {
    const out = write();
    if ("why" in out) {
      why = out.why;
      return null;
    }
    await recordOutside();
    for (const [file, text] of out.files) {
      ownWrites.set(file, Date.now());
      writeFileSync(safePath(file), text);
    }
    const now = Date.now();
    const id = `job-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const j: Job = {
      id, thread: id, try: 1, model: d.model, effort: d.effort, mode: "part", part: part.label, request, direct: true,
      state: "done", queuedAt: now, started: now, finished: now, log: [], summary: out.summary,
      usage: { input: 0, output: 0, costUsd: 0, seconds: 0, turns: 0 },
      progress: { phase: "applying", written: 0, lastAt: now }, partId: part.id,
    };
    await commit(j, { mode: "part", part: part.label, partId: part.id, prompt: "", request, model: d.model, effort: d.effort }, false, "direct");
    account(ROOT, j);
    return j;
  });
  if (direct) return { direct: true, entry: direct.entry, summary: direct.summary ?? "" };
  if (!d.claude) return { direct: false, why, tokens: askCost(part.id, request) };
  const job = startRun({ mode: "part", part: part.label, partId: part.id, prompt: promptOf(part), request: claudeRequest(why), model: d.model, effort: d.effort });
  return { direct: false, job, why, tokens: 0 };
}

// A string the part shows (a link's address, an image's source) swapped for another
export function swapString(d: DirectRequest & { from: string; to: string; what: string }) {
  const part = partOf(d.partId);
  const to = d.to.trim();
  if (!to || /["'`\n<>]/.test(to)) throw new Error("That address can't be written as is");
  // A picture the page loads at run time shows as a blob: or data: address that's in no file: say what it is instead
  const runtime = /^(blob|data):/.test(d.from);
  const request = runtime ? `Use ${to} as the ${d.what.replace(" source", "")} this part shows` : `Change the ${d.what} from ${d.from} to ${to}`;
  return directOrClaude(
    d,
    request,
    () => {
      if (runtime) return { why: "the page loads it at run time, so its address isn't written in the code as it shows" };
      const found = findString(searchFiles(part, readMap(), (f) => existsSync(join(ROOT, f))), d.from, readSite, part.id);
      if (!found.ok) return { why: found.why };
      const text = readSite(found.swap.file) ?? "";
      return { files: new Map([[found.swap.file, text.slice(0, found.swap.start) + to + text.slice(found.swap.end)]]), summary: `Changed the ${d.what} directly in ${found.swap.file}, with no Claude call.` };
    },
    (why) =>
      `${request}. Change only that, wherever this part uses it (a phone copy too)${d.what === "media source" ? `; the new file is already saved at ${to.startsWith("/") ? `public${to}` : to}, and if the page preloads the old one (a <link rel="preload"> in index.html) point that at the new one too` : ""}. (The studio couldn't do it directly: ${why}.)`,
  );
}

export type Param = { file: string; name?: string; find?: string; nth?: number; label?: string };
// A setting's key: its constant's name, or its find (and which number after it, for the 2nd+ of a pair)
export const keyOf = (p: Param & { nth?: number }) => p.name ?? (p.nth ? `${p.find}#${p.nth}` : (p.find ?? ""));
export const paramsOf = (part: MapPart) => ((part as MapPart & { params?: Param[] }).params ?? []).filter((p) => p && typeof p.file === "string" && (typeof p.name === "string" || typeof p.find === "string"));

// An effect's setting (a number constant in the part's code) set to a new value
export function setParam(d: DirectRequest & { name: string; value: number }) {
  const part = partOf(d.partId);
  const p = paramsOf(part).find((x) => keyOf(x) === d.name);
  if (!p) throw new Error(`${d.name} isn't a setting of ${part.label}`);
  const request = `Set ${p.label ?? keyOf(p)} to ${d.value}`;
  return directOrClaude(
    d,
    request,
    () => {
      const text = readSite(clean(p.file));
      const next = text === null ? null : setNumber(text, p, d.value);
      if (!next) return { why: p.name ? `${p.name} isn't a number constant in ${p.file} any more` : `the number after "${p.find}" isn't in ${p.file} once any more` };
      return { files: new Map([[clean(p.file), next]]), summary: `Set ${p.label ?? keyOf(p)} to ${d.value} in ${p.file}, with no Claude call.` };
    },
    (why) => `${request} (${p.name ? `the constant ${p.name}` : `the number after "${p.find}"`} in ${p.file}). (The studio couldn't do it directly: ${why}.)`,
  );
}
export const clean = (f: string) => f.replace(/\s*\(.*\)$/, "");
