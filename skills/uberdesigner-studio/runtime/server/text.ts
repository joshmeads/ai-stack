// Direct text edits: the person types over some text on the page, and the inspector writes the new words into the
// source itself, with no Claude call, when it can be sure where they came from. That's the case when the old text is
// written out exactly once in the part's own source: in a plain HTML page, inside the part's tagged markup (not in a
// script, a style or a tag); in a React component or a words module, once across the part's files and the map's
// shared files. Anything else (text the
// page's code makes, text split into letters for an animation, the same words twice, as in a phone copy, a change to
// the formatting inside the text) is not guessed at: the caller hands it to Claude as an ordinary part change.
//
// The page shows text with entities decoded (&amp; is "&") and, in React, with line breaks folded, so the search
// accepts either spelling of each character and any run of white space for a run of white space.

import { htmlElements, markupOnly } from "./slices.ts";

export type TextChange = { from: string; to: string }; // one text node: all its text before the edit, and after
export type Swap = { file: string; start: number; end: number; insert: string };
export type Found = { ok: true; swaps: Swap[] } | { ok: false; why: string };
type PartLike = { id: string; edit: string[]; files?: string[] };
type MapLike = { content?: { file: string } | null; extraFiles?: string[] };

const WS = /[ \t\r\n\f]+/; // white space as the page folds it (not the no-break space, which is a character)
const NAMED: Record<string, string[]> = {
  "&": ["amp"],
  "<": ["lt"],
  ">": ["gt"],
  '"': ["quot"],
  "'": ["apos", "#39"],
  " ": ["nbsp"],
  "‘": ["lsquo"],
  "’": ["rsquo"],
  "“": ["ldquo"],
  "”": ["rdquo"],
  "–": ["ndash"],
  "—": ["mdash"],
  "…": ["hellip"],
  "©": ["copy"],
  "·": ["middot"],
  "×": ["times"],
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

type Kind = "html" | "code";
const kindOf = (file: string): Kind => (/\.html?$/.test(file) ? "html" : "code");

// One character, as the source may spell it
function charPattern(c: string, kind: Kind): string {
  const code = c.codePointAt(0) ?? 0;
  const alts = [escapeRe(c), `&#0*${code};`, `&#[xX]0*${code.toString(16)};`, ...(NAMED[c] ?? []).map((n) => `&${n};`)];
  if (kind === "code") {
    if (code > 127) alts.push(`\\\\u${code.toString(16).padStart(4, "0")}`, `\\\\u\\{${code.toString(16)}\\}`);
    if (c === '"' || c === "'" || c === "`") alts.push(`\\\\${escapeRe(c)}`);
  }
  return /[a-zA-Z0-9 ]/.test(c) ? escapeRe(c) : `(?:${alts.join("|")})`;
}

// A run of text, as the source may spell it: any white space for white space (in React also {" "})
function textPattern(text: string, kind: Kind): string {
  const space = kind === "html" ? "[ \\t\\r\\n\\f]+" : `(?:[ \\t\\r\\n\\f]|\\{\\s*["'\`] ["'\`]\\s*\\})+`;
  return text
    .split(new RegExp(`(${WS.source})`))
    .map((piece) => (!piece ? "" : WS.test(piece) && !piece.trim() ? space : [...piece].map((c) => charPattern(c, kind)).join("")))
    .join("");
}

// The new words, written for that kind of file; null when they'd need code escaping (then Claude does it)
function encode(text: string, kind: Kind): string | null {
  if (kind === "html") return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
  return /[{}<>"'`\\\n]/.test(text) ? null : text;
}

// Where the changed words sit in the old text: the same start and end are kept, the middle is swapped
function middle(from: string, to: string) {
  let p = 0;
  while (p < from.length && p < to.length && from[p] === to[p]) p++;
  let s = 0;
  while (s < from.length - p && s < to.length - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
  return { before: from.slice(0, p), old: from.slice(p, from.length - s), next: to.slice(p, to.length - s), after: from.slice(from.length - s) };
}

// Inside text, not inside a tag, a script, a style or a comment
function inHtmlText(text: string, masked: string, start: number, end: number): boolean {
  if (masked.slice(start, end) !== text.slice(start, end)) return false;
  return masked.lastIndexOf(">", start - 1) >= masked.lastIndexOf("<", start - 1);
}

// The edit was to one whole text on the page, so a hit is a whole text in the source: between tags in HTML; a whole
// string or a whole JSX text in code. A match inside a longer text (a sentence quoted in a meta description) isn't it.
const OPENS: Record<Kind, RegExp> = { html: />$/, code: /[>}"'`]$/ };
const CLOSES: Record<Kind, RegExp> = { html: /^</, code: /^[<{"'`]/ };
function wholeText(text: string, start: number, end: number, kind: Kind): boolean {
  const before = text.slice(Math.max(0, start - 200), start).replace(/[ \t\r\n\f]+$/, "");
  const after = text.slice(end, end + 200).replace(/^[ \t\r\n\f]+/, "");
  return OPENS[kind].test(before) && CLOSES[kind].test(after);
}

export function findText(part: PartLike, map: MapLike, changes: TextChange[], read: (file: string) => string | null): Found {
  // The part's files, and the shared files the map names (a words module is usually one of those)
  const files = [...new Set([...part.edit, ...(part.files ?? []), ...(map.content?.file ? [map.content.file] : []), ...(map.extraFiles ?? [])])].filter(
    (f) => /\.(html?|tsx?|jsx?|mjs|json)$/.test(f) && !/(^|\/)(package(-lock)?|inspector\.map)\.json$/.test(f),
  );
  const swaps: Swap[] = [];
  for (const change of changes) {
    if (change.from === change.to) continue;
    const m = middle(change.from, change.to);
    // The words around the change pin it down; the white space at the very ends doesn't (React drops it)
    const before = m.before.replace(/^[ \t\r\n\f]+/, "");
    const after = m.after.replace(/[ \t\r\n\f]+$/, "");
    if (!(before + m.old + after).trim()) return { ok: false, why: "the text was only spaces" };
    const hits: Swap[] = [];
    for (const file of files) {
      const text = read(file);
      if (text === null) continue;
      const kind = kindOf(file);
      const insert = encode(m.next, kind);
      const re = new RegExp(`${textPattern(before, kind)}(${textPattern(m.old, kind)})${textPattern(after, kind)}`, "gd");
      const ranges = kind === "html" ? htmlElements(text, part.id) : [{ start: 0, end: text.length }];
      const masked = kind === "html" ? markupOnly(text) : text;
      for (const hit of text.matchAll(re)) {
        const start = hit.index ?? 0;
        const end = start + hit[0].length;
        if (!ranges.some((r) => start >= r.start && end <= r.end)) continue;
        if (kind === "html" && !inHtmlText(text, masked, start, end)) continue;
        if (!wholeText(text, start, end, kind)) continue;
        const [s, e] = hit.indices?.[1] ?? [start, start];
        if (insert === null) return { ok: false, why: "the new words need writing as code" };
        hits.push({ file, start: s, end: e, insert });
      }
    }
    if (!hits.length) return { ok: false, why: "the words aren't written out in the part's files" }; // made by code, or split up
    if (hits.length > 1) return { ok: false, why: `the words appear ${hits.length} times in this part` };
    swaps.push(hits[0]);
  }
  if (!swaps.length) return { ok: false, why: "nothing changed" };
  // Two edits in the same place can't both be applied
  const sorted = [...swaps].sort((a, b) => (a.file === b.file ? a.start - b.start : a.file.localeCompare(b.file)));
  for (let i = 1; i < sorted.length; i++) if (sorted[i].file === sorted[i - 1].file && sorted[i].start < sorted[i - 1].end) return { ok: false, why: "two edits overlap" };
  return { ok: true, swaps };
}

// The files with the swaps made (each file's swaps from the end, so earlier offsets stay right)
export function applySwaps(swaps: Swap[], read: (file: string) => string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of [...new Set(swaps.map((s) => s.file))]) {
    let text = read(file) ?? "";
    for (const s of swaps.filter((x) => x.file === file).sort((a, b) => b.start - a.start)) text = text.slice(0, s.start) + s.insert + text.slice(s.end);
    out.set(file, text);
  }
  return out;
}
