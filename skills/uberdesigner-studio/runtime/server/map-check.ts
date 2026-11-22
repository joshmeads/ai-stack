// Has the map fallen behind the site? Files it names that are gone, parts whose tag left the code, page files no part
// covers, a build prompt edited since. Free to ask: nothing is sent to Claude.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tagTargetsOf, tagsIn } from "./address.ts";
import type { MapEntry } from "./map-store.ts";
import { editableFiles, type MapPart, readMap, ROOT, STATE } from "./site.ts";

export type MapCheck = {
  behind: boolean;
  missingFiles: { file: string; parts: string[] }[];
  untagged: { id: string; label: string }[];
  newFiles: string[];
  promptChanged: boolean;
  absent: string[];
};
export const PAGE_FILE = /\.(tsx|jsx|css|html?)$/;
export const NOT_A_PART = /(^|\/)(main|index)\.(tsx|jsx)$|^src\/inspector\//; // entry files and the old in-project inspector
export const PROMPT_SLACK_MS = 60_000; // a prompt saved in the same setup as the map isn't "changed after it"
export const withoutNote = (f: string) => f.replace(/\s*\(.*\)$/, ""); // "src/App.tsx (intro timings)" -> the path

export const mapTimeOf = () => Math.round(statSync(join(ROOT, "inspector.map.json")).mtimeMs);
export const pageFiles = (files = editableFiles()) => files.filter((f) => PAGE_FILE.test(f) && !NOT_A_PART.test(f));
// Every layer id tagged in the site's markup files
export function codeTags(files = editableFiles()): Set<string> {
  const tags = new Set<string>();
  for (const f of files) if (/\.(tsx|jsx|html?)$/.test(f)) for (const id of tagsIn(readFileSync(join(ROOT, f), "utf8"))) tags.add(id);
  return tags;
}
export type Baseline = { map: number; files: string[] };

// The page files as they are now, recorded as the ones this map knew about
export function writeMapBaseline(files?: string[]): Baseline {
  const base: Baseline = { map: mapTimeOf(), files: pageFiles(files) };
  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, "map-baseline.json"), JSON.stringify(base, null, 2) + "\n");
  return base;
}

export function mapCheck(): MapCheck | null {
  const mapFile = join(ROOT, "inspector.map.json");
  if (!existsSync(mapFile)) return null;
  const map = readMap();
  const parts = map.parts ?? [];
  const mapTime = mapTimeOf();

  // Every file the map names, and who names it
  const named = new Map<string, Set<string>>();
  const name = (f: string | null | undefined, who: string) => {
    if (!f) return;
    const path = withoutNote(f);
    named.set(path, (named.get(path) ?? new Set<string>()).add(who));
  };
  for (const p of parts) for (const f of [...(p.files ?? []), ...(p.edit ?? [])]) name(f, p.label);
  for (const f of map.extraFiles ?? []) name(f, "shared files");
  name(map.tokensFile, "design tokens");
  name(map.content?.file, "words");
  name(map.source?.prompt, "build prompt");
  const missingFiles = [...named].filter(([f]) => !existsSync(join(ROOT, f))).map(([file, who]) => ({ file, parts: [...who] }));

  // Parts placed on the page by a tag in the code (the ones with tag targets) whose tag is gone from it. A part found
  // by a selector has no tag to lose: whether the page still answers its address is the panel's to say.
  const files = editableFiles();
  const tags = codeTags(files);
  // Parts the inspector's own changes removed or added come and go with their tags (Undo, History): not "behind"
  const managed = (p: MapPart) => !!((p as MapEntry).removed || (p as MapEntry).added);
  const untagged = parts.filter((p) => p.id !== "site" && !managed(p) && tagTargetsOf(p).length > 0 && !tags.has(p.id)).map((p) => ({ id: p.id, label: p.label }));

  // Page files that are new since the map was written and that no part covers
  let base: Baseline | null = null;
  try {
    base = JSON.parse(readFileSync(join(STATE, "map-baseline.json"), "utf8")) as Baseline;
  } catch {
    /* a map from before baselines: this first check takes it */
  }
  if (!base || base.map !== mapTime) base = writeMapBaseline(files);
  const known = new Set(base.files);
  const newFiles = pageFiles(files).filter((f) => !named.has(f) && !known.has(f));

  const prompt = map.source?.prompt ? join(ROOT, withoutNote(map.source.prompt)) : null;
  const promptChanged = !!prompt && existsSync(prompt) && statSync(prompt).mtimeMs > mapTime + PROMPT_SLACK_MS;

  // Removed or added parts whose tag isn't in the code now: the panel leaves them out of the layers
  const absent = parts.filter((p) => managed(p) && !tags.has(p.id)).map((p) => p.id);
  return { behind: missingFiles.length + untagged.length + newFiles.length > 0 || promptChanged, missingFiles, untagged, newFiles, promptChanged, absent };
}

// The same, as one line for the terminal when the dev server starts (null when the map is up to date)
export function mapCheckLine(): string | null {
  let c: MapCheck | null = null;
  try {
    c = mapCheck();
  } catch {
    return null;
  }
  if (!c?.behind) return null;
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const what = [
    c.untagged.length && `${n(c.untagged.length, "part")} no longer tagged in the code`,
    c.missingFiles.length && `${n(c.missingFiles.length, "file")} gone`,
    c.newFiles.length && `${n(c.newFiles.length, "new file")} no part covers`,
    c.promptChanged && "the build prompt changed",
  ].filter(Boolean);
  return `uberdesigner studio: the map is behind the site (${what.join(", ")}). Ask Claude Code to update the uberdesigner studio map.`;
}
