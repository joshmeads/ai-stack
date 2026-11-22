// Finding one element in an HTML source by its place under another: "the 5th of 6 blockquotes in the 1st of 1 divs"
// under the element whose opening tag starts at a given offset. The editor reads that place off the page for an
// object the person picked (panel objects.ts addressOf); this finds the same element in the file, so its tag can be
// written there. The count of siblings is part of every step, and the caller compares the tag, the classes and the
// first words too: a source the scan can't follow (end tags left out, markup a script adds or reorders) fails those
// and is left alone, never tagged by guess. Pure text work: no Node, no parser.

import { markupOnly } from "./slices.ts";

export type Step = { tag: string; nth: number; of: number };
export type SourceElement = { start: number; nameEnd: number; end: number; tag: string; open: string; text: string };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

export function elementAt(html: string, from: number, path: Step[]): SourceElement | null {
  const masked = markupOnly(html);
  TAG_RE.lastIndex = from;
  const first = TAG_RE.exec(masked);
  if (!first || first.index !== from || first[1] === "/") return null;
  let at = { start: first.index, end: first.index + first[0].length, tag: first[2].toLowerCase() };
  for (const step of path) {
    // The children of `at`: every opening tag met at depth 0 until its own closing tag
    TAG_RE.lastIndex = at.end;
    let depth = 0;
    let count = 0;
    let hit: typeof at | null = null;
    let closed = false;
    for (let m = TAG_RE.exec(masked); m; m = TAG_RE.exec(masked)) {
      const tag = m[2].toLowerCase();
      if (m[1] === "/") {
        if (depth === 0) {
          closed = tag === at.tag;
          break;
        }
        depth--;
        continue;
      }
      if (depth === 0 && tag === step.tag.toLowerCase() && ++count === step.nth) hit = { start: m.index, end: m.index + m[0].length, tag };
      if (m[4] !== "/" && !VOID.has(tag)) depth++;
    }
    if (!closed || !hit || count !== step.of) return null;
    at = hit;
  }
  const text = masked.slice(at.end, at.end + 400).split("<")[0];
  return { ...at, nameEnd: at.start + 1 + at.tag.length, open: html.slice(at.start, at.end), text };
}

// An attribute of an opening tag ("" when it has none)
export function attrOf(open: string, name: string): string {
  const m = open.match(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`, "i"));
  return m ? m[1].replace(/^["']|["']$/g, "") : "";
}

// Words as a person reads them: entities for spaces and the common signs decoded, runs of space as one
export const plainWords = (s: string) =>
  s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/[ \s]+/g, " ")
    .trim();
