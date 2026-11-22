// Keeping the map in step with the code after a write (reconcile.ts works out what changed): layers a change added or
// removed, new settings, tokens that came or went.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tagsIn } from "./address.ts";
import { readNumber } from "./direct.ts";
import { reconcile, type Snapshot, type TokenInfo } from "./reconcile.ts";
import type { MapChange, ParamEntry } from "./answer.ts";
import { type MapPart, readMap, readSite, ROOT, view } from "./site.ts";

// Is the map behind the site? A free check (no tokens) the panel runs when it opens: files the map names that are gone,
// parts whose data-dm tag left the code, page files that appeared after the map was written and no part covers, and
// a build prompt edited after the map. Any of these means the design-map skill should update the map (SKILL.md,
// "Updating a map"). New files are judged against .inspector/map-baseline.json: the page files there were when this map
// was written. apply.mjs takes it as it writes the map; for a map written before that existed, the first check takes it.
// A part change that added or removed tagged elements keeps the map in step: new parts go in after their parent's
// other parts (with its group, files and edit list), removed ones are marked "removed" rather than dropped, so an
// Undo that brings the element back brings its layer back too (the panel shows a removed or added part only while
// its tag is in the code). Returns a line for the change's log, or null when nothing changed.
export type MapEntry = MapPart & { group?: string; parent?: string; kind?: string; added?: boolean; removed?: boolean };
export function updateMap(change: MapChange, fromPart: string, touched: string[], request: string): string | null {
  const path = join(ROOT, "inspector.map.json");
  let raw: { parts?: MapEntry[]; tokens?: Record<string, unknown> } & Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as typeof raw;
  } catch {
    return null;
  }
  const parts = raw.parts ?? [];
  const shared = new Set([...((raw.extraFiles as string[] | undefined) ?? []), ...((raw.content as { file?: string } | null | undefined)?.file ? [(raw.content as { file: string }).file] : [])]);
  const tags = new Set<string>();
  for (const f of touched) for (const id of tagsIn(readSite(f) ?? "")) tags.add(id);
  const said: string[] = [];
  for (const a of change.add) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(a.id) || a.id === "site") continue;
    const old = parts.find((p) => p.id === a.id);
    if (old && !old.removed) continue;
    if (!tags.has(a.id)) continue; // Claude listed it but didn't tag it: nothing on the page to pick
    const parent = parts.find((p) => p.id === a.parent) ?? parts.find((p) => p.id === fromPart);
    if (!parent) continue;
    if (old) {
      delete old.removed;
      said.push(a.label);
      continue;
    }
    const entry: MapEntry = {
      id: a.id,
      label: a.label.slice(0, 60),
      group: parent.group,
      parent: parent.id,
      ...(a.kind && ["section", "frame", "text", "image", "video", "button", "icon", "scene", "list"].includes(a.kind) ? { kind: a.kind } : {}),
      prompt: [{ where: "Added in the inspector", text: request.slice(0, 300) }],
      tokens: a.tokens.filter((t) => /^--[\w-]+$/.test(t)),
      files: [...new Set([...(parent.files ?? []), ...touched])],
      // Not the big shared files the change happened to touch (words, timelines): later changes to it would send them
      edit: [...new Set([...parent.edit, ...touched.filter((f) => parent.edit.includes(f) || !(shared.has(f) || (readSite(f) ?? "").length > 9000))])],
      added: true,
      // A custom cursor follows the pointer over the page and the panel: hidden while inspecting
      ...(/\bcursor\b/i.test(`${a.id.replace(/-/g, " ")} ${a.label}`) && !/light|glow/i.test(a.label) ? { hideWhileInspecting: true } : {}),
    };
    // After the parent's last nested part
    const inParent = (p: MapEntry): boolean => p.id === parent.id || (!!p.parent && inParent(parts.find((x) => x.id === p.parent) ?? ({} as MapEntry)));
    let at = parts.findIndex((p) => p.id === parent.id);
    while (at + 1 < parts.length && inParent(parts[at + 1])) at++;
    parts.splice(at + 1, 0, entry);
    said.push(entry.label);
  }
  const removed: string[] = [];
  const drop = (id: string) => {
    const p = parts.find((x) => x.id === id);
    if (!p || p.removed) return;
    p.removed = true;
    removed.push(p.label);
    parts.filter((x) => x.parent === id).forEach((x) => drop(x.id));
  };
  for (const id of change.remove) if (!tags.has(id)) drop(id);
  if (!said.length && !removed.length) return null;
  raw.parts = parts;
  writeMap(raw);
  return [said.length && `Added to the layers: ${said.join(", ")}`, removed.length && `Removed from the layers: ${removed.join(", ")}`].filter(Boolean).join(". ");
}

// --- Keeping the map in step (reconcile.ts): after every write, what the code can tell is worked out again

export let mapAt = 0; // when the server last changed the map: the panel offers to reload its layers after that
// The map changed by other hands (a whole-site run edits the file itself)
export const touchMap = () => void (mapAt = Date.now());
export function writeMap(raw: unknown) {
  if (raw && typeof raw === "object") keepGroups(raw as { groups?: unknown; parts?: unknown });
  writeFileSync(join(ROOT, "inspector.map.json"), JSON.stringify(raw, null, 2) + "\n");
  mapAt = Date.now();
}
// Every group a part names is in the map's "groups" (a section a change added brings its own group; apply.mjs
// refuses a part whose group isn't listed)
export function keepGroups(raw: { groups?: unknown; parts?: unknown }): boolean {
  const groups = Array.isArray(raw.groups) ? (raw.groups as string[]) : [];
  const named = Array.isArray(raw.parts) ? (raw.parts as { group?: unknown }[]).map((p) => p.group).filter((g): g is string => typeof g === "string" && !!g) : [];
  const missing = [...new Set(named)].filter((g) => !groups.includes(g));
  if (missing.length) raw.groups = [...groups, ...missing];
  return missing.length > 0;
}
// When the map last changed, by any hand: the server's own writes, a whole-site run or the skill writing the file.
// The editor holds the map it was given with this number, and reads the map again when the number moves.
export function mapChangedAt(): number {
  try {
    return Math.max(mapAt, Math.round(statSync(join(ROOT, "inspector.map.json")).mtimeMs));
  } catch {
    return mapAt;
  }
}

// The design files the map knows (its layers' files, the shared files, the tokens file), as Claude sees them
export const DESIGN_FILE = /\.(css|html?|[jt]sx?)$/;
export function designSnapshot(extra: string[] = []): Snapshot {
  const map = readMap();
  const named = new Set<string>([...(map.parts ?? []).flatMap((p) => [...(p.files ?? []), ...p.edit]), ...(map.extraFiles ?? []), ...(map.tokensFile ? [map.tokensFile] : []), ...extra]);
  const out: Snapshot = new Map();
  for (const f of named) if (DESIGN_FILE.test(f) && !/\.d\.ts$/.test(f) && existsSync(join(ROOT, f))) out.set(f, view(f));
  return out;
}

// Bring the map in step with the files after a write; returns what changed, in plain words
export function syncMap(before: Snapshot, touched: string[], opts: { request?: string; described?: Record<string, TokenInfo>; focus?: string[] } = {}): string[] {
  const path = join(ROOT, "inspector.map.json");
  let raw: Parameters<typeof reconcile>[0] & Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as typeof raw;
  } catch {
    return [];
  }
  const after = designSnapshot(touched);
  const r = reconcile(raw, before, after, opts);
  // A layer removed in the inspector whose tag is back (Undo, a restore): listed again
  const tags = new Set<string>();
  for (const text of after.values()) for (const id of tagsIn(text)) tags.add(id);
  for (const p of (raw.parts ?? []) as (MapEntry & { removed?: boolean })[]) {
    if (p.removed && tags.has(p.id)) {
      delete p.removed;
      r.notes.push(`${p.label} is back in the layers`);
      r.changed = true;
    }
  }
  if (r.changed) writeMap(raw);
  return r.notes;
}

// Effect settings a change returns in map.params: a new one is added, one with an existing label is corrected (the
// change moved the code it points at) or removed ("remove": true). Kept only when the new anchor finds exactly one
// number; the setting's range stays as the map had it.
export function addParams(partId: string | undefined, params: ParamEntry[]): string {
  if (!partId || !params.length) return "";
  const raw = JSON.parse(readFileSync(join(ROOT, "inspector.map.json"), "utf8")) as { parts?: (MapEntry & { params?: ParamEntry[] })[] } & Record<string, unknown>;
  const own = raw.parts?.find((p) => p.id === partId);
  if (!own) return "";
  const added: string[] = [];
  const fixed: string[] = [];
  const removed: string[] = [];
  for (const q of params) {
    if (!q?.label) continue;
    // The layer that has a value with this label: the changed one first, then any other (a value of another layer
    // that the change moved)
    const holder = (own.params ?? []).some((x) => x.label === q.label) ? own : (raw.parts?.find((p) => (p.params ?? []).some((x) => x.label === q.label)) ?? own);
    const part = holder;
    const same = (part.params ?? []).findIndex((x) => x.label === q.label);
    if (q.remove) {
      if (same >= 0) {
        part.params = (part.params ?? []).filter((_, i) => i !== same);
        removed.push(q.label);
      }
      continue;
    }
    if (typeof q.file !== "string") continue;
    // A correction that doesn't say which number of a list keeps the one the value had (the "end" of a [start, end] pair)
    const keepNth = same >= 0 && q.nth === undefined ? (part.params ?? [])[same].nth : undefined;
    const nth = q.nth ?? keepNth;
    const anchor = { find: q.find, name: q.find ? undefined : q.name, nth: q.find && nth ? nth : undefined };
    const text = readSite(q.file);
    const at = text !== null ? readNumber(text, anchor) : null;
    if (at === null) continue;
    const entry = { file: q.file, ...(q.find ? { find: q.find, ...(anchor.nth ? { nth: anchor.nth } : {}) } : { name: q.name }) };
    if (same >= 0) {
      const old = (part.params ?? [])[same];
      const { find: _f, name: _n, nth: _t, ...rest } = old;
      part.params = (part.params ?? []).map((x, i) => (i === same ? { ...rest, ...entry } : x));
      fixed.push(q.label);
      continue;
    }
    if ((part.params ?? []).some((x) => x.file === q.file && (x.find ?? x.name) === (q.find ?? q.name) && (x.nth ?? 0) === (anchor.nth ?? 0))) continue;
    const span = Math.max(Math.abs(at) * 2, 1);
    part.params = [...(part.params ?? []), { ...entry, label: q.label.slice(0, 40), min: q.min ?? Math.min(0, at), max: q.max ?? at + span }];
    added.push(q.label);
  }
  if (added.length || fixed.length || removed.length) writeMap(raw);
  return [added.length ? `new settings: ${added.join(", ")}` : "", fixed.length ? `settings moved with the code: ${fixed.join(", ")}` : "", removed.length ? `settings removed: ${removed.join(", ")}` : ""].filter(Boolean).join("; ");
}
