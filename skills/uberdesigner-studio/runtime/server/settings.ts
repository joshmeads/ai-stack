// Effect settings that move. A setting is "the number after this text", read fresh each time, so a change that moves
// or removes that text is noticed (the layer gets a "check" mark), and the settings' definitions have their own log so
// Undo and Restore bring them back with the code.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readNumber } from "./direct.ts";
import type { TokenInfo } from "./reconcile.ts";
import type { ParamEntry } from "./answer.ts";
import { clean, keyOf, type Param, paramsOf } from "./direct-changes.ts";
import type { Entry } from "./jobs.ts";
import { type MapEntry, writeMap } from "./map-store.ts";
import { type DesignMap, type MapPart, readMap, readSite, ROOT, STATE } from "./site.ts";

// --- Settings that move. A setting is "the number after this text", read fresh each time, so a change that moves the
// code around it can leave it pointing at nothing (lost) or quietly at another number (a new row in a table). Each
// setting's last known number is kept in .inspector/settings.json and checked after every version: lost settings are
// flagged whoever caused it; a number changed by a Claude change or an edit outside the inspector is flagged with who
// did it ("check it's still the right number"); the person's own edits, undo and restore don't flag, and a flag clears
// when its number is back where it was or when the person says it's fine.
export type SettingFlag = { was: number | null; now: number | null; by: string; at: string };
export type SettingsState = { known: Record<string, { file: string; value: number | null }>; flags: Record<string, SettingFlag> };
export const settingsFile = () => join(STATE, "settings.json");
export const settingKey = (partId: string, p: Param) => `${partId}|${keyOf(p)}`;
export function readSettings(): SettingsState | null {
  try {
    return JSON.parse(readFileSync(settingsFile(), "utf8")) as SettingsState;
  } catch {
    return null;
  }
}
export function settingsNow(): Map<string, { file: string; value: number | null }> {
  const out = new Map<string, { file: string; value: number | null }>();
  for (const part of readMap().parts ?? []) {
    for (const p of paramsOf(part)) {
      const text = readSite(clean(p.file));
      out.set(settingKey(part.id, p), { file: clean(p.file), value: text === null ? null : readNumber(text, p) });
    }
  }
  return out;
}
export function checkSettings(kind: Entry["kind"] | "load", label: string): SettingsState {
  const prev = readSettings();
  const next: SettingsState = { known: {}, flags: {} };
  const at = new Date().toISOString();
  const flagsChanges = kind === "change" || kind === "outside";
  for (const [k, cur] of settingsNow()) {
    const old = prev?.known[k];
    const flag = prev?.flags[k];
    next.known[k] = { file: cur.file, value: cur.value ?? old?.value ?? null };
    if (cur.value === null) {
      next.flags[k] = flag?.now === null ? flag : { was: old?.value ?? null, now: null, by: prev ? label : "the map", at };
      continue;
    }
    if (!old || old.value === null) {
      // new, or found again: a lost one that came back with a different number is worth a look
      if (flag?.now === null && flag.was !== null && cur.value !== flag.was && flagsChanges) next.flags[k] = { ...flag, now: cur.value, by: label, at };
      continue;
    }
    if (flag && cur.value === flag.was) continue; // back where it was
    if (cur.value !== old.value && flagsChanges) next.flags[k] = { was: flag?.was ?? old.value, now: cur.value, by: label, at };
    else if (flag && cur.value === flag.now) next.flags[k] = flag; // untouched since it was flagged
  }
  mkdirSync(STATE, { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(next, null, 1));
  return next;
}
export const settingsState = () => readSettings() ?? checkSettings("load", "the map");
export function settingFlagsFor(partId: string): Record<string, SettingFlag> {
  const flags = settingsState().flags;
  return Object.fromEntries(Object.entries(flags).filter(([k]) => k.startsWith(`${partId}|`)).map(([k, f]) => [k.slice(partId.length + 1), f]));
}
export function settingFlagCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(settingsState().flags)) {
    const id = k.slice(0, k.indexOf("|"));
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}
// The map isn't part of the inspector's versions (it's the tool's own file), but a change writes into it: it corrects
// where values point (map.params) and describes the tokens it adds (map.tokens). Each version's definitions of both are
// logged in .inspector/settings-log.json (only when they differ), so Undo can put back what the undone change wrote
// (unless a later change touched it) and Restore what that version had. Layers need none of this: a layer is listed
// while its tag is in the code. Keys: "partId|label" for a value, "token|--name" for a token's description.
export type MapDef = ParamEntry | TokenInfo;
export type ParamDefs = Record<string, MapDef>;
export const settingsLogFile = () => join(STATE, "settings-log.json");
export const versionNo = (id: string) => Number(id.replace(/^v/, "")) || 0;
export const TOKEN_KEY = "token|";
export function paramDefs(): ParamDefs {
  const out: ParamDefs = {};
  const map = readMap() as DesignMap & { tokens?: Record<string, TokenInfo> };
  for (const part of map.parts ?? []) for (const p of ((part as MapPart & { params?: ParamEntry[] }).params ?? [])) if (p?.label) out[`${part.id}|${p.label}`] = p;
  for (const [name, info] of Object.entries(map.tokens ?? {})) out[`${TOKEN_KEY}${name}`] = info;
  return out;
}
export function readSettingsLog(): { at: string; defs: ParamDefs }[] {
  try {
    return JSON.parse(readFileSync(settingsLogFile(), "utf8")) as { at: string; defs: ParamDefs }[];
  } catch {
    return [];
  }
}
export function logParamDefs(version: string) {
  const log = readSettingsLog();
  const defs = paramDefs();
  if (log.length && JSON.stringify(log[log.length - 1].defs) === JSON.stringify(defs)) return;
  mkdirSync(STATE, { recursive: true });
  writeFileSync(settingsLogFile(), JSON.stringify([...log, { at: version, defs }]));
}
// The definitions as they were at a version (the last log entry at or before it), or null when the log starts later
export function paramDefsAt(version: number): ParamDefs | null {
  let found: ParamDefs | null = null;
  for (const e of readSettingsLog()) if (versionNo(e.at) <= version) found = e.defs;
  return found;
}
// Write definitions back into the map: a key set to null is removed
export function putParamDefs(changes: Record<string, MapDef | null>): string[] {
  const keys = Object.keys(changes);
  if (!keys.length) return [];
  const raw = JSON.parse(readFileSync(join(ROOT, "inspector.map.json"), "utf8")) as { parts?: (MapEntry & { params?: ParamEntry[] })[]; tokens?: Record<string, TokenInfo> } & Record<string, unknown>;
  for (const k of keys) {
    if (k.startsWith(TOKEN_KEY)) {
      const name = k.slice(TOKEN_KEY.length);
      raw.tokens ??= {};
      if (changes[k]) raw.tokens[name] = changes[k] as TokenInfo;
      else delete raw.tokens[name];
      continue;
    }
    const [partId, label] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    const part = raw.parts?.find((p) => p.id === partId);
    if (!part) continue;
    const def = changes[k] as ParamEntry | null;
    const list = (part.params ?? []).filter((x) => x.label !== label);
    const at = (part.params ?? []).findIndex((x) => x.label === label);
    if (def) list.splice(at >= 0 ? at : list.length, 0, def);
    part.params = list;
  }
  writeMap(raw);
  return keys.map((k) => k.slice(k.indexOf("|") + 1));
}
// Undo of versions first..last: definitions those versions changed go back to how they were before them, unless
// something after them changed them again
export function undoParamDefs(first: number, last: number): string[] {
  const before = paramDefsAt(first - 1);
  const after = paramDefsAt(last);
  if (!before || !after) return [];
  const now = paramDefs();
  const changes: Record<string, MapDef | null> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = JSON.stringify(before[k] ?? null);
    const became = JSON.stringify(after[k] ?? null);
    if (was !== became && JSON.stringify(now[k] ?? null) === became) changes[k] = before[k] ?? null;
  }
  return putParamDefs(changes);
}
// Bring back a change that was taken out: the definitions it had set come back where they still stand as before it
export function redoParamDefs(first: number, last: number): string[] {
  const before = paramDefsAt(first - 1);
  const after = paramDefsAt(last);
  if (!before || !after) return [];
  const now = paramDefs();
  const changes: Record<string, MapDef | null> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = JSON.stringify(before[k] ?? null);
    const became = JSON.stringify(after[k] ?? null);
    if (was !== became && JSON.stringify(now[k] ?? null) === was) changes[k] = after[k] ?? null;
  }
  return putParamDefs(changes);
}
// Restore to a version: its definitions
export function restoreParamDefs(version: number): string[] {
  const at = paramDefsAt(version);
  if (!at) return [];
  const now = paramDefs();
  const changes: Record<string, MapDef | null> = {};
  for (const k of new Set([...Object.keys(at), ...Object.keys(now)])) if (JSON.stringify(at[k] ?? null) !== JSON.stringify(now[k] ?? null)) changes[k] = at[k] ?? null;
  return putParamDefs(changes);
}

export function settingOk(partId: string, key: string) {
  const s = settingsState();
  for (const k of Object.keys(s.flags)) if (k === `${partId}|${key}` || (key === "*" && k.startsWith(`${partId}|`))) delete s.flags[k];
  writeFileSync(settingsFile(), JSON.stringify(s, null, 1));
}
