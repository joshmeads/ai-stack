// Keeping the map in step with the code. The skill writes the map once; after that every write (a Claude change, a
// whole-site run, Undo, a History restore, Use this one) goes through reconcile(), which works out from the code what
// the code can tell and leaves in the map only what it can't (labels, groups, prompt lines, facts):
// - tokens: a token newly defined in the tokens file gets a description (Claude's label and role when it gave them,
//   else its kind from the value and a name from the code); a token a layer lists that the map doesn't describe gets
//   one too, and one the tokens file no longer defines is dropped from the layer;
// - which tokens a layer shows: the tokens its own CSS rules (the rules for the classes on its element and inside it,
//   leaving out nested layers) used before the write and after it. What its rules stopped using leaves the layer, what
//   they started using joins it; everything else on the list is kept as the skill wrote it.
// Plain text work, no parser: the same "view" of the files the rest of the server uses.

import { TAG, tagRe, tagsIn } from "./address.ts";

export type TokenInfo = { kind?: string; role?: string; label?: string };
export type ReconPart = { id: string; label: string; tokens: string[]; edit?: string[]; files?: string[]; removed?: boolean; added?: boolean };
export type ReconMap = { tokensFile?: string | null; parts?: ReconPart[]; tokens?: Record<string, TokenInfo> };
export type Snapshot = Map<string, string>; // file -> text, for the design files (styles, markup, components)

export function tokenKind(value: string): string {
  const v = value.trim();
  if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|color-mix\()/i.test(v)) return "color";
  if (/^-?[\d.]+em$/.test(v)) return "em";
  if (/^[\d.]+m?s$/.test(v)) return "ms";
  if (/^-?[\d.]+$/.test(v)) return "number";
  if (/^-?[\d.]+(px|rem|vw|vh|svh|dvh|%)$/.test(v) || /^(calc|min|max|clamp)\(/.test(v)) return "size";
  return "text";
}

// "--text-feature-title" -> "Text feature title"
const nameOf = (token: string) => {
  const words = token.replace(/^--/, "").split(/[-_]+/).filter(Boolean).join(" ");
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40);
};

export const cssOfFile = (file: string, text: string) =>
  /\.css$/.test(file) ? text : /\.html?$/.test(file) ? [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") : "";

const blank = (s: string) => s.replace(/[^\n]/g, " ");

// The plain :root tokens of a stylesheet (not the ones inside @media), last one winning
export function rootTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  for (const m of clean.matchAll(/:root\s*\{([^}]*)\}/g)) {
    const before = clean.slice(0, m.index ?? 0);
    if ((before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length > 0) continue;
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out.set(d[1], d[2].trim());
  }
  return out;
}

type Rule = { selector: string; body: string };
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  const walk = (start: number, end: number) => {
    let i = start;
    while (i < end) {
      const open = src.indexOf("{", i);
      if (open < 0 || open >= end) return;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < end && depth) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      if (/^@(media|supports|container|layer)\b/i.test(prelude)) walk(open + 1, j - 1);
      else if (prelude && !prelude.startsWith("@") && !prelude.startsWith(":root")) out.push({ selector: prelude, body: src.slice(open + 1, j - 1) });
      i = j;
    }
  };
  walk(0, src.length);
  return out;
}


// Where an opening tag ends: the first ">" outside quotes and JSX braces (an arrow function's "=>" doesn't count)
function openEnd(text: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i + 1;
  }
  return text.length;
}

// The extent of every element tagged data-dm="id" in a file (HTML or JSX)
function extents(text: string, id: string): [number, number][] {
  const out: [number, number][] = [];
  if (!text.includes(TAG)) return out;
  for (const a of text.matchAll(tagRe(id))) {
    const start = text.lastIndexOf("<", a.index ?? 0);
    const name = start < 0 ? undefined : text.slice(start + 1).match(/^([A-Za-z][\w.-]*)/)?.[1];
    if (!name) continue;
    let end = openEnd(text, start);
    if (text.slice(end - 2, end) !== "/>" && !/^(img|input|br|hr|meta|link|source)$/i.test(name)) {
      const tags = new RegExp(`<(/?)${name.replace(/\./g, "\\.")}(?=[\\s/>])`, "g");
      tags.lastIndex = end;
      let depth = 1;
      for (let t = tags.exec(text); t; t = tags.exec(text)) {
        const close = openEnd(text, t.index);
        tags.lastIndex = close;
        if (!t[1] && text.slice(close - 2, close) === "/>") continue; // self-closing: no depth change
        depth += t[1] === "/" ? -1 : 1;
        if (depth === 0) {
          end = close;
          break;
        }
      }
    }
    out.push([start, end]);
  }
  return out;
}

// The markup of each element tagged data-dm="id", with the nested layers' markup blanked out (they're their own)
function taggedMarkup(text: string, id: string): string[] {
  return extents(text, id).map(([start, end]) => {
    let snippet = text.slice(start, end);
    const inner = new Set(tagsIn(snippet).filter((x) => x !== id));
    for (const other of inner) for (const [a, b] of extents(snippet, other)) snippet = snippet.slice(0, a) + blank(snippet.slice(a, b)) + snippet.slice(b);
    return snippet;
  });
}

const posix = (path: string) => {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
};

// A layer's classes: global ones (class="a", className="a"), and CSS Module ones per module file (styles.a in a file
// that imports styles from "./X.module.css" only matches .a in X.module.css)
type Classes = { global: Set<string>; modules: Map<string, Set<string>>; tags: Set<string> };
function classesOf(file: string, text: string, snippet: string, into: Classes) {
  for (const m of snippet.matchAll(/\bclass(?:Name)?\s*=\s*["']([^"']+)["']/g)) m[1].split(/\s+/).forEach((c) => c && into.global.add(c));
  const imports = [...text.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+\.module\.css)["']/g)];
  for (const [, name, rel] of imports) {
    const mod = posix(`${file.split("/").slice(0, -1).join("/")}/${rel}`);
    const set = into.modules.get(mod) ?? new Set<string>();
    for (const m of snippet.matchAll(new RegExp(`\\b${name}\\.([\\w-]+)`, "g"))) set.add(m[1]);
    for (const m of snippet.matchAll(new RegExp(`\\b${name}\\[["'\`]([\\w-]+)["'\`]\\]`, "g"))) set.add(m[1]);
    into.modules.set(mod, set);
  }
  const first = snippet.match(/^<([a-z][\w-]*)\b[^>]*>/);
  if (first && !/\sclass(Name)?=/.test(first[0])) into.tags.add(first[1].toLowerCase());
}

// Whether a rule styles a layer: per comma part, its last compound (the element it styles) carries one of the layer's
// classes (".card .title" is .title's, not .card's), or it's a classless element ("p", "h3 a") inside one of them
// (".copy > p" is .copy's), or the layer's classless element itself
function stylesLayer(selector: string, classes: Set<string>, tags: Set<string>): boolean {
  return selector.split(",").some((part) => {
    const compounds = part.trim().replace(/::?[\w-]+(\([^)]*\))?/g, "").split(/[\s>+~]+/).filter(Boolean);
    const last = compounds.pop() ?? "";
    const own = [...last.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    if (own.length) return own.some((c) => classes.has(c));
    const tag = last.match(/^([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase();
    if (!tag) return false;
    const inside = compounds.some((c) => [...c.matchAll(/\.([A-Za-z_][\w-]*)/g)].some((m) => classes.has(m[1])));
    return inside || (!compounds.length && tags.has(tag));
  });
}

// The tokens a layer's own rules use, given the files as they are in `files`
function tokensOfPart(part: ReconPart, files: Snapshot, defined: Set<string>): Set<string> {
  const used = new Set<string>();
  const cls: Classes = { global: new Set(), modules: new Map(), tags: new Set() };
  for (const [file, text] of files) {
    if (!text.includes(part.id)) continue;
    for (const snippet of taggedMarkup(text, part.id)) classesOf(file, text, snippet, cls);
  }
  if (!cls.global.size && !cls.modules.size && !cls.tags.size) return used;
  for (const [file, text] of files) {
    if (!/\.(css|html?)$/.test(file)) continue;
    const isModule = /\.module\.css$/.test(file);
    const classes = isModule ? cls.modules.get(file) : cls.global;
    if (!classes?.size && (isModule || !cls.tags.size)) continue;
    for (const r of rules(cssOfFile(file, text))) {
      if (!stylesLayer(r.selector, classes ?? new Set(), isModule ? new Set() : cls.tags)) continue;
      for (const v of r.body.matchAll(/var\(\s*(--[\w-]+)/g)) if (defined.has(v[1])) used.add(v[1]);
    }
  }
  return used;
}

export type Reconciled = { changed: boolean; notes: string[] };

// Bring the map in step after a write. `before` and `after` hold the design files as they were and are (at least the
// ones the write touched); `request` names new tokens' role when Claude gave none; `described` is what Claude said
// about the tokens it added; `focus` adds layers to re-check even if their files didn't change (the requesting layer).
export function reconcile(map: ReconMap, before: Snapshot, after: Snapshot, opts: { request?: string; described?: Record<string, TokenInfo>; focus?: string[] } = {}): Reconciled {
  const notes: string[] = [];
  let changed = false;
  const tf = map.tokensFile ?? null;
  map.tokens ??= {};
  const parts = (map.parts ?? []).filter((p) => !p.removed);
  const defsAfter = tf && after.has(tf) ? rootTokens(cssOfFile(tf, after.get(tf) ?? "")) : null;
  const defsBefore = tf && before.has(tf) ? rootTokens(cssOfFile(tf, before.get(tf) ?? "")) : defsAfter;

  // 1. New tokens: described
  if (defsAfter && defsBefore) {
    for (const [name, value] of defsAfter) {
      if (defsBefore.has(name) || map.tokens[name]) continue;
      const said = opts.described?.[name] ?? {};
      map.tokens[name] = {
        kind: tokenKind(value),
        role: (said.role ?? (opts.request ? `Added in the inspector: ${opts.request}` : "Added in the inspector")).slice(0, 200),
        label: (said.label ?? nameOf(name)).slice(0, 40),
      };
      notes.push(`described the new token ${name} ("${map.tokens[name].label}")`);
      changed = true;
    }
  }

  // 2. Which tokens each affected layer shows: what its rules stopped using leaves, what they started using joins
  const defined = new Set<string>([...(defsAfter?.keys() ?? []), ...(defsBefore?.keys() ?? [])]);
  const touched = new Set([...after.keys()].filter((f) => before.get(f) !== after.get(f)));
  const touchesStyle = [...touched].some((f) => /\.(css|html?|[jt]sx?)$/.test(f));
  if (defined.size && touchesStyle) {
    const full = (snap: Snapshot) => new Map([...after].map(([f, t]) => [f, snap.get(f) ?? t]));
    const was = full(before);
    for (const p of parts) {
      const relevant = opts.focus?.includes(p.id) || p.added || [...touched].some((f) => (p.edit ?? []).includes(f) || (p.files ?? []).includes(f) || after.get(f)?.includes(p.id));
      if (!relevant) continue;
      const usedBefore = tokensOfPart(p, was, defined);
      const usedAfter = tokensOfPart(p, after, defined);
      const gone = [...usedBefore].filter((t) => !usedAfter.has(t));
      const came = [...usedAfter].filter((t) => !usedBefore.has(t) && !p.tokens.includes(t));
      const next = [...p.tokens.filter((t) => !gone.includes(t)), ...came];
      if (next.join() !== p.tokens.join()) {
        const had = new Set(p.tokens);
        p.tokens = next;
        changed = true;
        const left = gone.filter((t) => had.has(t));
        notes.push(`${p.label}: ${[came.length ? `now shows ${came.join(", ")}` : "", left.length ? `no longer ${left.join(", ")}` : ""].filter(Boolean).join("; ")}`);
      }
    }
  }

  // 3. Every token a layer lists is defined and described (whole-site runs write the map themselves)
  if (defsAfter) {
    for (const p of parts) {
      const missing = p.tokens.filter((t) => !defsAfter.has(t));
      if (missing.length) {
        p.tokens = p.tokens.filter((t) => defsAfter.has(t));
        changed = true;
        notes.push(`${p.label}: dropped ${missing.join(", ")} (no longer in ${tf})`);
      }
      for (const t of p.tokens) {
        if (map.tokens[t]?.label) continue;
        map.tokens[t] = { kind: map.tokens[t]?.kind ?? tokenKind(defsAfter.get(t) ?? ""), role: map.tokens[t]?.role ?? "Described by the inspector", label: nameOf(t) };
        changed = true;
        notes.push(`described ${t}, which ${p.label} uses`);
      }
    }
  }
  return { changed, notes };
}
