// Claude's answer to a part change: read from its JSON, and its edits applied to the files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { placeEdits, type Source } from "./slices.ts";
import type { TokenInfo } from "./reconcile.ts";
import { EDITABLE, rel, ROOT, safePath, strip, unstrip } from "./site.ts";

export type Edit = { file: string; find: string; replace: string };
export type Create = { file: string; content: string };
export type Needs = { packages: string[]; files: string[]; newFiles: string[]; why?: string };
export type ParamEntry = { file: string; find?: string; name?: string; nth?: number; label: string; min?: number; max?: number; step?: number; motion?: boolean; remove?: boolean };
export type MapChange = { add: { id: string; label: string; parent: string; kind?: string; tokens: string[] }[]; remove: string[]; tokens?: Record<string, TokenInfo>; params?: ParamEntry[] };
export type Answer = { summary: string; edits: Edit[]; create: Create[]; needs: Needs | null; map?: MapChange };

export const PACKAGE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
export const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseAnswer(text: string): Answer {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { summary: text.trim().slice(0, 600), edits: [], create: [], needs: null };
  const data = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; edits?: unknown; create?: unknown; needs?: unknown; map?: unknown };
  const edits = Array.isArray(data.edits) ? data.edits : [];
  for (const e of edits) {
    if (!e || typeof e.file !== "string" || typeof e.find !== "string" || typeof e.replace !== "string") {
      throw new Error("Claude returned an edit without file, find and replace");
    }
  }
  const create = (Array.isArray(data.create) ? data.create : []).filter(
    (c): c is Create => !!c && typeof c.file === "string" && typeof c.content === "string",
  );
  const n = data.needs as { packages?: unknown; files?: unknown; newFiles?: unknown; why?: unknown } | undefined;
  const needs: Needs | null = n
    ? { packages: strings(n.packages), files: strings(n.files), newFiles: strings(n.newFiles), why: typeof n.why === "string" ? n.why : undefined }
    : null;
  const empty = !needs || needs.packages.length + needs.files.length + needs.newFiles.length === 0;
  const m = (data.map ?? {}) as { add?: unknown; remove?: unknown; tokens?: unknown; params?: unknown };
  const add = (Array.isArray(m.add) ? m.add : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof a.id === "string" && typeof a.label === "string" && typeof a.parent === "string")
    .map((a) => ({ id: a.id as string, label: a.label as string, parent: a.parent as string, kind: typeof a.kind === "string" ? a.kind : undefined, tokens: strings(a.tokens) }));
  const tokens: Record<string, TokenInfo> = {};
  if (m.tokens && typeof m.tokens === "object")
    for (const [name, v] of Object.entries(m.tokens as Record<string, unknown>)) {
      const t = (v ?? {}) as { label?: unknown; role?: unknown };
      if (/^--[\w-]+$/.test(name)) tokens[name] = { label: typeof t.label === "string" ? t.label : undefined, role: typeof t.role === "string" ? t.role : undefined };
    }
  const params = (Array.isArray(m.params) ? m.params : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof x.file === "string" && typeof x.label === "string" && (typeof x.find === "string" || typeof x.name === "string"))
    .map((x) => ({ file: x.file as string, find: typeof x.find === "string" ? x.find : undefined, name: typeof x.name === "string" ? x.name : undefined, label: x.label as string, min: typeof x.min === "number" ? x.min : undefined, max: typeof x.max === "number" ? x.max : undefined }));
  const map = add.length || strings(m.remove).length || Object.keys(tokens).length || params.length ? { add, remove: strings(m.remove), tokens, params } : undefined;
  return { summary: typeof data.summary === "string" ? data.summary : "", edits: edits as Edit[], create, needs: empty ? null : needs, map };
}

// Every edit and new file is checked first; nothing is written unless all of them apply. Returns the paths touched.
// Edits are matched against the same view of each file Claude was sent (embedded data as placeholders).
export function applyAnswer(a: Answer, allowed: string[], allowNew: boolean, sent: Source[] = []): string[] {
  const next = new Map<string, string>();
  for (const c of a.create) {
    const path = normalize(c.file).replace(/\\/g, "/");
    if (!allowNew) throw new Error(`Claude tried to create ${path}, but new files weren't allowed`);
    if (!EDITABLE.test(path) || path.includes("..")) throw new Error(`Can't create ${path}: only code, style and page files of the site`);
    if (existsSync(resolve(ROOT, path)) && !allowed.includes(path)) throw new Error(`Claude tried to overwrite ${path}, which wasn't sent`);
    next.set(resolve(ROOT, path), c.content);
  }
  // A file's edits are placed together against the file as it was sent, so each find is looked for inside the slices
  // Claude saw, however many edits the file gets (slices.ts placeEdits)
  const byFile = new Map<string, Edit[]>();
  for (const e of a.edits) {
    if (!allowed.includes(e.file)) throw new Error(`Claude tried to edit ${e.file}, which wasn't sent`);
    byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  }
  for (const [file, edits] of byFile) {
    const abs = safePath(file);
    const created = next.get(abs); // a file this answer also creates: its edits go into the new text
    const text = created ?? strip(file, readFileSync(abs, "utf8"));
    const placed = placeEdits(text, edits, created === undefined ? sent.find((x) => x.file === file) : undefined);
    if (typeof placed !== "string") throw new Error(`An edit for ${file} ${placed.why}`);
    next.set(abs, placed);
  }
  const restored = new Map([...next].map(([file, text]) => [file, unstrip(rel(file), text)]));
  restored.forEach((text, file) => {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  });
  return [...restored.keys()].map((f) => rel(f));
}
