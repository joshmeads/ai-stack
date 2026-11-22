// What a designer would call a thing on the page, whether the map lists it or not: the one rule that says what can be
// picked. tree.ts turns the running page into a tree with it (sections, the blocks inside them, the parts inside
// blocks) and the map is laid over that tree for names, files and values; a thing the map doesn't list is addressed
// by its place under the nearest tagged layer, with nothing written anywhere, and becomes a layer of the map only
// when it is changed or kept (Editor.tsx, server/layers.ts).
//
// A thing is one of:
//   - a layer of the map (its element carries the inspector's tag);
//   - a block of words: the element whose own line of words it is (a paragraph, a heading, a quote, a label). Never
//     one letter or word of it: a title split into a span per letter is still one block;
//   - a link or a button, with or without words;
//   - a picture, a video or a drawing, as a whole: never a line inside a drawing, never a piece of a canvas;
//   - a box with a look of its own: a fill, a picture behind it, a border or a shadow.
// What isn't one: a box that only holds other things and paints nothing, and what has no box at all.
// Plain DOM reads, asked when a row opens, on a click or on a slow hover, never per frame.

import { TAG, tagTargetsOf } from "../../server/address";
import { fileWords, once } from "./names";
import { partById, type Part, type PartKind } from "./parts";
import { paints, visibleNow, type Rect } from "./presence";
import { elementsOf, layerAround, layerIdOf } from "./resolve";

export type Step = { tag: string; nth: number; of: number }; // the nth of `of` children with that tag
export type Found = { el: Element; kind: PartKind; label: string; rect: Rect };

const INLINE = /^(inline|inline-block|inline-flex|inline-grid|contents|ruby)/;
// Tags that mark a piece of a line of words, whatever box a stylesheet gives them: a letter or a word set in a span
// (even one laid out as a flex item) is a piece of its line, never the block of words itself
const PIECE = new Set(["span", "b", "i", "em", "strong", "small", "s", "u", "mark", "sub", "sup", "abbr", "bdi", "bdo", "code", "kbd", "var", "q", "cite", "ins", "del", "font", "tt", "wbr"]);
// Never a thing, and nothing inside is one
const NOTHING = new Set(["script", "style", "noscript", "template", "link", "meta", "title", "head", "br", "wbr", "option", "optgroup", "source", "track", "param", "area", "map"]);

const ownWords = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
const isLink = (el: Element) => el.localName === "a" || el.localName === "button" || el.getAttribute("role") === "button";
// A look of its own: what presence.ts calls painting, or a shadow (a card that is only a shadow is a card)
function hasFace(el: Element, win: Window): boolean {
  if (paints(el, win)) return true;
  const shadow = win.getComputedStyle(el).boxShadow;
  return !!shadow && shadow !== "none";
}
// A piece of a line of words: set inline (or in a tag that only styles words), and nothing by itself: not a link, and
// with no look of its own (a pill, a painted badge and a button set inline are things)
function isPiece(el: Element, win: Window): boolean {
  if (isLink(el) || NOTHING.has(el.localName)) return false;
  if (!PIECE.has(el.localName) && !INLINE.test(win.getComputedStyle(el).display)) return false;
  return !hasFace(el, win);
}
const holdsWords = (el: Element) => (el.textContent ?? "").trim().length > 0;

// What an element is as a thing of its own, by what it is on the page (not by the map), or null
export function kindOf(el: Element, win: Window): PartKind | null {
  const tag = el.localName;
  if (NOTHING.has(tag) || (el as SVGElement).ownerSVGElement) return null;
  if (tag === "svg") return "icon";
  if (tag === "picture") return "image";
  if (tag === "img") return el.parentElement?.localName === "picture" ? null : "image";
  if (tag === "video") return "video";
  if (tag === "canvas") return "scene";
  const link = isLink(el);
  // Its own line of words: words of its own, or words in pieces that are nothing by themselves
  if (ownWords(el) || [...el.children].some((c) => isPiece(c, win) && holdsWords(c))) {
    if (!link && isPiece(el, win)) return null; // a word of somebody else's line
    return link ? "button" : "text";
  }
  if (link) return "button";
  return hasFace(el, win) ? "frame" : null;
}

// Whether a block of words can be seen: one of the elements that hold its words can. A line typed in letter by
// letter, or one of several lines stacked in one place that take turns, is "visible" as a block and has its box
// while not one of its letters shows: picking would land on a line nobody sees.
const PIECES = 600; // elements of one block looked at
export function wordsShow(el: Element): boolean {
  if (ownWords(el)) return true; // words of its own, not in pieces: the block's own visibility says it
  let n = 0;
  for (const piece of el.querySelectorAll("*")) {
    if (++n > PIECES) break;
    if (ownWords(piece) && visibleNow(piece)) return true;
  }
  return false;
}

// --- A name, from what it is

const clip = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fileName = (url: string | null | undefined) =>
  fileWords(
    decodeURIComponent((url ?? "").split(/[?#]/)[0].split("/").pop() ?? "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_.]+/g, " ")
      .trim(),
  );
// "s7__award is-on" -> "s7 award"; a CSS module's "_card_x1b2c" -> "card"
export const className = (el: Element) =>
  (el.getAttribute("class") ?? "")
    .split(/\s+/)[0]
    .replace(/^_([A-Za-z][\w-]*?)_[A-Za-z0-9-]{5}(_\d+)?$/, "$1")
    .replace(/[-_]+/g, " ")
    .trim();
// The first words inside an element, without laying anything out (a card's innerText is its whole text, read slowly)
function firstWords(el: Element, max = 40): string {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* text */);
  let out = "";
  for (let n = walker.nextNode(), k = 0; n && out.length < max && k < 200; n = walker.nextNode(), k++) {
    const piece = (n.textContent ?? "").replace(/\s+/g, " ").trim();
    if (piece && !NOTHING.has(n.parentElement?.localName ?? "")) out += `${out ? " " : ""}${piece}`;
  }
  return out;
}
export function nameOf(el: Element, kind: PartKind): string {
  const said = el.getAttribute("aria-label") ?? el.querySelector(":scope > title")?.textContent ?? "";
  if (kind === "text" || kind === "button") {
    // As read on the page (a line break between words is a space), else as written
    const words = once(((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim());
    return clip(words || said.trim() || className(el) || el.localName);
  }
  if (kind === "image") {
    const img = el.localName === "img" ? el : el.querySelector("img");
    return clip(img?.getAttribute("alt")?.trim() || fileName(img?.getAttribute("src")) || className(el) || "Picture");
  }
  if (kind === "video") return clip(fileName((el as HTMLVideoElement).currentSrc || el.getAttribute("src") || el.getAttribute("data-src") || el.querySelector("source")?.getAttribute("src")) || className(el) || "Video");
  if (kind === "icon") return clip(said.trim() || className(el) || "Drawing");
  if (kind === "scene") return clip(className(el) || "Canvas");
  // A box: what the code calls it, else its first words, else the picture it holds
  const called = className(el);
  return clip(said.trim() || (called ? `${called[0].toUpperCase()}${called.slice(1)}` : "") || once(firstWords(el)) || el.querySelector("img")?.getAttribute("alt")?.trim() || "Box");
}

// --- An address, with nothing written anywhere: its place under the nearest layer that carries its tag in the code
// (`anchor`, that layer's element; `anchorId`, its id). Each step says which of its parent's children with that tag
// it is, and of how many, so the server can find the same element in the source and be sure it is the same.

// `which`: when the layer has several elements (a row of cards) and this one can be told apart by its place among its
// siblings, the address is of the object in this one; else it is of that object in each of them.
export function addressOf(el: Element, anchor: Element, anchorId: string, all: readonly Element[] = [anchor]): { selector: string; path: Step[]; which?: { nth: number; of: number } } | null {
  const path: Step[] = [];
  for (let at: Element | null = el; at && at !== anchor; at = at.parentElement) {
    const parent: Element | null = at.parentElement;
    if (!parent) return null;
    const same = [...parent.children].filter((c) => c.localName === at.localName);
    path.unshift({ tag: at.localName, nth: same.indexOf(at) + 1, of: same.length });
  }
  if (!path.length) return null;
  let from = `[${TAG}='${anchorId}']`;
  let which: { nth: number; of: number } | undefined;
  if (all.length > 1 && anchor.parentElement) {
    const nth = [...anchor.parentElement.children].filter((c) => c.localName === anchor.localName).indexOf(anchor) + 1;
    if (all.filter((a) => a.matches(`${from}:nth-of-type(${nth})`)).length === 1) {
      from += `:nth-of-type(${nth})`;
      which = { nth: all.indexOf(anchor) + 1, of: all.length };
    }
  }
  const selector = `${from} > ${path.map((s) => `${s.tag.replace(/[^A-Za-z0-9_-]/g, "\\$&")}:nth-of-type(${s.nth})`).join(" > ")}`;
  return selector.length <= 300 ? { selector, path, which } : null;
}

// --- The page is the outer layer. What no layer holds (an overlay, a preloader or an app mock-up a script adds to the
// page by itself; a region the map never listed) is still on the page: it is addressed from the nearest element
// around it with an id of its own (a script's overlay usually has one), else from <body>, then tag by tag, as an
// object in a layer is addressed from its layer. (The rule and the server's side of it, server/layers.ts PAGE, come
// from the "page is the outer layer" change of 17 Nov, made for ⌘-click then.)
export const PAGE = "@page";
function pageAddressOf(el: Element): { selector: string; path: Step[] } | null {
  const doc = el.ownerDocument;
  let from: Element = doc.body;
  for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
    if (a.id && /^[A-Za-z][\w-]*$/.test(a.id) && doc.querySelectorAll(`#${a.id}`).length === 1) {
      from = a;
      break;
    }
  }
  const path: Step[] = [];
  for (let at: Element | null = el; at && at !== from; at = at.parentElement) {
    const parent: Element | null = at.parentElement;
    if (!parent) return null;
    const same = [...parent.children].filter((c) => c.localName === at.localName);
    path.unshift({ tag: at.localName, nth: same.indexOf(at) + 1, of: same.length });
  }
  if (!path.length) return null;
  const selector = `${from === doc.body ? "body" : `#${from.id}`} > ${path.map((s) => `${s.tag.replace(/[^A-Za-z0-9_-]/g, "\\$&")}:nth-of-type(${s.nth})`).join(" > ")}`;
  return selector.length <= 300 ? { selector, path } : null;
}

// The same object always gets the same id, so picking it again is the same layer
export function idOf(selector: string): string {
  let h = 2166136261;
  for (let i = 0; i < selector.length; i++) h = Math.imul(h ^ selector.charCodeAt(i), 16777619);
  return `pick-${(h >>> 0).toString(36)}`;
}

// What the server is told when a picked object becomes a layer (server/layers.ts PickedLayer), and what tells the
// editor it is still the same element after the page changed around it
export type Facts = { id: string; anchor: string; which?: { nth: number; of: number }; path: Step[]; tag: string; classes: string; words: string; src: string };

// A thing the map doesn't list, as the layer it would be: listed under the layer it was found in, with that layer's
// files, found by its address. Where nothing around it is a layer the code is tagged for, it is on the page itself:
// listed at the top with the whole site, addressed from the page, with no files of its own.
export function describe(el: Element, kind: PartKind): { part: Part; facts: Facts } | null {
  const doc = el.ownerDocument;
  const inCode = (x: Element | null) => {
    const layer = partById(layerIdOf(x));
    return !!layer && tagTargetsOf(layer).length > 0;
  };
  let anchor = layerAround(el.parentElement);
  while (anchor && !inCode(anchor)) anchor = layerAround(anchor.parentElement);
  const anchorId = layerIdOf(anchor);
  // Listed under the nearest layer of the map around it (a layer that was only picked isn't one)
  let around = layerAround(el.parentElement);
  while (around && !partById(layerIdOf(around))) around = layerAround(around.parentElement);
  const within = partById(layerIdOf(around)) ?? partById(anchorId);
  const inLayer = anchor && anchorId && within ? addressOf(el, anchor, anchorId, elementsOf(doc, anchorId)) : null;
  const address: { selector: string; path: Step[]; which?: { nth: number; of: number } } | null = inLayer ?? (anchorId ? null : pageAddressOf(el));
  if (!address) return null;
  const label = nameOf(el, kind);
  const media = el.localName === "img" || el.localName === "video" ? el : el.querySelector("img, video");
  const id = idOf(address.selector);
  const home = inLayer && within ? { group: within.group, parent: within.id, files: within.files, edit: within.edit } : { group: "Site", files: [], edit: [] };
  return {
    part: { id, label, ...home, kind, prompt: [{ where: "Picked in the editor", text: label }], tokens: [], targets: [{ selector: address.selector }] },
    facts: { id, anchor: inLayer && anchorId ? anchorId : PAGE, which: address.which, path: address.path, tag: el.localName, classes: el.getAttribute("class") ?? "", words: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200), src: media?.getAttribute("src") ?? media?.getAttribute("data-src") ?? "" },
  };
}
// Whether an element is the one those facts were taken from: the same tag, and the same words, the same picture or
// the same class names (words change when they are typed over; a class may come and go as the page runs)
export function sameAs(el: Element, facts: Facts): boolean {
  if (el.localName !== facts.tag) return false;
  const words = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (words && words === facts.words) return true;
  const media = el.localName === "img" || el.localName === "video" ? el : el.querySelector("img, video");
  const src = media?.getAttribute("src") ?? media?.getAttribute("data-src") ?? "";
  if (src && src === facts.src) return true;
  const classes = el.getAttribute("class") ?? "";
  return classes === facts.classes && (!!classes || (!words && !facts.words && !src && !facts.src));
}
