// Where a layer is. A layer of the map is an address that resolves to elements on the page, and there are three kinds:
//
// 1. a tag: the attribute apply.mjs writes onto an element in the source (data-dm="hero"). The usual one.
// 2. a selector: a CSS selector the page is asked for, usually starting from a tagged layer
//    ("[data-dm='features'] h2"). For what the source can't tag: an element a component renders without passing props
//    on, markup a script or a generator writes. Nothing is written into the code for it; the panel marks the matching
//    elements on the page while it runs (panel-src/inspector/resolve.ts).
// 3. none: no targets at all. A piece inside a canvas, listed for its values and never outlined.
//
// The attribute is the inspector's own name, so a site that uses data-part (or anything else) for itself is left
// alone and can still have those elements as layers. Maps made before 16 Nov 2026 used data-part; apply.mjs renames
// those tags once (the map's "tag" field says which name its tags use).
//
// Plain text work with no imports beyond values.ts, shared by the server, the setup scripts and the panel.

import { unclosed } from "./values.ts";

export const TAG = "data-dm";
export const OLD_TAG = "data-part";

export type Target = { file?: string; find?: string; nth?: number; forwards?: boolean; selector?: string };
type Addressed = { id: string; targets?: unknown[] };

const asTarget = (t: unknown): Target => (t && typeof t === "object" ? (t as Target) : {});
// One spelling for a selector wherever it's compared or written: single spaces, double quotes around attribute values
const normal = (selector: string) => selector.trim().replace(/\s+/g, " ").replace(/=\s*'([^'"]*)'/g, '="$1"');

// A layer's selector addresses, and its tag targets (the elements apply.mjs tags in the source)
export const selectorsOf = (part: Addressed): string[] =>
  (part.targets ?? [])
    .map((t) => asTarget(t).selector)
    .filter((s): s is string => typeof s === "string" && !!s.trim())
    .map(normal);
export const tagTargetsOf = (part: Addressed): Target[] => (part.targets ?? []).map(asTarget).filter((t) => typeof t.selector !== "string" && typeof t.file === "string");

// --- the tag, on the page and in the source

export const tagSelector = (id: string) => `[${TAG}="${id}"]`;
const ID = "[\\w-]+";
const quoted = (id: string) => `(?:"(${id})"|'(${id})'|\\{\\s*["'\`](${id})["'\`]\\s*\\})`;
// Every tag in a piece of source (HTML or JSX): data-dm="id", data-dm='id', data-dm={"id"}
export function tagsIn(text: string, attr = TAG): string[] {
  if (!text.includes(attr)) return [];
  return [...text.matchAll(new RegExp(`${attr}=${quoted(ID)}`, "g"))].map((m) => m[1] ?? m[2] ?? m[3]);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One layer's tag in source, with the white space before it
export const tagRe = (id: string, flags = "g") => new RegExp(`\\s${TAG}=${quoted(escapeRe(id))}`, flags);
export const hasTag = (text: string, id: string) => text.includes(TAG) && tagRe(id, "").test(text);

// --- a selector address

// Why a selector can't be a layer's address, in plain words; null when it can. It ends up in a stylesheet (the rule a
// layer's own values are saved under), so it must not be able to close that rule or the <style> block around it.
export function selectorProblem(selector: unknown): string | null {
  if (typeof selector !== "string" || !selector.trim()) return "it's empty";
  const s = selector.trim();
  if (s.length > 300) return "it's longer than 300 characters";
  if (/[\r\n]/.test(s)) return "it has a line break";
  const bad = s.match(/[{};<]|\/\*|\*\//);
  if (bad) return `it has "${bad[0]}", which can't be part of a selector`;
  if (/::/.test(s)) return "it names a pseudo-element (::before, ::after), which isn't an element on the page";
  if (/^[>+~,]|[>+~,]$/.test(s)) return "it starts or ends with a combinator";
  return unclosed(s);
}

// The tagged layers a selector starts from or passes through: [data-dm='features'] h2 -> ["features"]
export const anchorsOf = (selector: string): string[] => [...selector.matchAll(new RegExp(`\\[\\s*${TAG}\\s*=\\s*["']?(${ID})["']?\\s*\\]`, "g"))].map((m) => m[1]);

// --- where a layer's own values are saved: one rule in the tokens file

// The selector of that rule: the tag for a tagged layer, its address for an addressed one (the mark the panel puts on
// an addressed element exists only while the inspector is open, so a rule under it would never apply on the real site)
export function ruleSelector(part: Addressed): string {
  const own = selectorsOf(part);
  if (!own.length) return tagSelector(part.id);
  return [...(tagTargetsOf(part).length ? [tagSelector(part.id)] : []), ...own].join(", ");
}

// That rule in a stylesheet, found by its selector at the start of a rule (never the tail of a longer selector), with
// quotes and spacing free to differ from how it was written
export function ruleRe(selector: string): RegExp {
  const body = normal(selector)
    .split(/\s*,\s*/)
    .map((piece) => escapeRe(piece).replace(/"/g, `["']`).replace(/ /g, "\\s+"))
    .join("\\s*,\\s*");
  return new RegExp(`(?<=(?:^|[{};])\\s*)${body}\\s*\\{[^}]*\\}`, "g");
}

// --- for Claude: one line saying what an addressed layer is on the page (a tagged layer needs none)

export function addressNote(part: Addressed, labelOf: (id: string) => string | undefined): string {
  const own = selectorsOf(part);
  if (!own.length) return "";
  const around = [...new Set(own.flatMap(anchorsOf))].map((id) => labelOf(id) ?? id);
  return (
    `On the page this part is the element${own.length > 1 ? "s" : ""} matching ${own.map((s) => `\`${s}\``).join(" and ")}` +
    `${around.length ? ` (inside ${around.join(", ")})` : ""}. It has no ${TAG} tag of its own in the code: don't add one. ` +
    `A style for this part alone goes in a rule with that selector.`
  );
}
