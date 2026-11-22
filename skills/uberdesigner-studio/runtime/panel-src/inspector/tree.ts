// The running page as a tree of things, and the map laid over it.
//
// One rule (objects.ts) says what a thing is: a layer of the map, a block of words, a link or a button, a picture,
// a video or a drawing, a box with a look of its own. A thing's parent is the nearest thing around it, so the page
// reads as sections, the blocks inside them, the parts inside blocks, however many plain wrappers sit between. The
// map gives names, files and values to the things it lists; the rest are named from what they are and addressed by
// their place (objects.ts describe).
//
// Everything that picks asks here: what is under the pointer and what a click there would pick (Outlines.tsx), what a
// row of the list holds (Editor.tsx), which block a picked thing is inside. The answers are worked out when asked,
// only for the branch asked about, and kept until the page or the map changes (never per frame).

import { TAG } from "../../server/address";
import { describe, kindOf as objectKind, wordsShow, type Facts } from "./objects";
import { childrenOf, isPickedObject, kindOf as layerKind, mapRev, partById, type PageTree, type Part, type PartKind } from "./parts";
import { paintsOver, shownRects } from "./presence";
import { elementsOf, layerAround, layerElements, layerIdOf, pageRev } from "./resolve";

// --- Which layer sits in which, and their order, as the page has them: parts.ts turns that into the list of layers
// (setPageTree). A layer's first element speaks for it.
export function readTree(doc: Document): PageTree & { key: string } {
  const index = new Map<string, number>();
  const parent = new Map<string, string | null>();
  layerElements(doc).forEach((el, i) => {
    const id = layerIdOf(el);
    if (!id || index.has(id) || !partById(id)) return; // a layer's first element speaks for it; a tag the map doesn't know is nobody's
    index.set(id, i);
    // The nearest element around it that is a layer the map knows
    let around = layerAround(el.parentElement);
    while (around && !partById(layerIdOf(around))) around = layerAround(around.parentElement);
    parent.set(id, around ? layerIdOf(around) : null);
  });
  return { index, parent, key: [...index.keys()].map((id) => `${id}<${parent.get(id) ?? ""}`).join(",") };
}

// --- The things

// quiet: a layer the map says is never outlined (a full-screen scene, an intro): listed, never picked on the page;
// what it holds is picked as if it weren't there
export type Thing = { el: Element; layer: string | null; kind: PartKind; quiet: boolean };
// A thing as something to pick, outline and list: a layer by its id, or an object by the id its address gives it
// (the same id it has once picked or kept)
// el: its element (the one under the pointer); null for a layer with no element on this page
export type Target = { key: string; layer: string | null; label: string; kind: PartKind; el: Element | null; els: readonly Element[]; object?: { part: Part; facts: Facts } };
// A layer of the map as a target, whether or not the page carries it
export const layerTarget = (doc: Document | null | undefined, part: Part): Target => ({ key: part.id, layer: part.id, label: part.label, kind: layerKind(part, elementsOf(doc, part.id)[0] ?? null), el: elementsOf(doc, part.id)[0] ?? null, els: elementsOf(doc, part.id) });

const ANY = `[${TAG}]`;
const MAX = 8000; // elements looked at under one thing
const MIN = 4; // px: smaller than this either way isn't something to pick
const SLACK = 4; // px around a thin thing (a 1 px rule, a 30 px ticker in a scaled view)
const SAME = 0.9; // of each other's box: two things this alike in size are one step
const DEPTH = 32;

// What was worked out for an element, until the map changes or the page does. A page that never stops changing (a
// ticker adding nodes, a script that keeps switching classes) would have everything read again at every ask. So an
// answer is good for `floor` ms at least, and the floor follows what reading costs: the time spent reading the page
// is added up second by second, and while it is over SHARE of the time the floor grows; when it is well under, the
// floor shrinks back. The tree never takes more than a few percent of the time, however big the page and however
// often it changes.
type Kept = { stamp: string; page: number; at: number; self?: Thing | null; kids?: Thing[]; has?: boolean; target?: Target | null };
const kept = new WeakMap<Element, Kept>();
const FLOOR_MIN = 400;
const FLOOR_MAX = 8000;
const SHARE = 0.03;
let floor = FLOOR_MIN;
let spent = { since: 0, ms: 0 }; // reading done in the second under way
let epoch = 0;
// Names and kinds are read again (words were typed over, a change landed)
export const forgetTree = () => void epoch++;
type Ctx = { win: Window; doc: Document; stamp: string; page: number; now: number };
function ctxOf(win: Window): Ctx {
  const now = performance.now();
  if (now - spent.since >= 1000) {
    const share = spent.ms / (now - spent.since);
    if (share > SHARE) floor = Math.min(FLOOR_MAX, floor * 1.6);
    else if (share < SHARE / 3) floor = Math.max(FLOOR_MIN, floor * 0.8);
    spent = { since: now, ms: 0 };
  }
  return { win, doc: win.document, stamp: `${mapRev()}:${epoch}:${win.innerWidth}`, page: pageRev(win.document), now };
}
function keptOf(el: Element, c: Ctx): Kept {
  let k = kept.get(el);
  if (!k || k.stamp !== c.stamp || (k.page !== c.page && c.now - k.at >= floor)) {
    k = { stamp: c.stamp, page: c.page, at: c.now };
    kept.set(el, k);
  }
  return k;
}
// Reading the page, timed: the outermost call counts (a walk inside a walk is already in it)
let reading = 0;
function read<T>(work: () => T): T {
  if (reading++) {
    try {
      return work();
    } finally {
      reading--;
    }
  }
  const t0 = performance.now();
  try {
    return work();
  } finally {
    reading--;
    spent.ms += performance.now() - t0;
  }
}

// A layer the map came with, not one picked in the editor (kept or not)
const ofTheMap = (id: string | null) => {
  const part = partById(id);
  return !!part && !part.picked && !isPickedObject(part.id);
};
function thingOf(el: Element, c: Ctx): Thing | null {
  const k = keptOf(el, c);
  if (k.self !== undefined) return k.self;
  const id = el.getAttribute(TAG);
  const part = id ? partById(id) : undefined;
  if (id && part) return (k.self = { el, layer: id, kind: layerKind(part, el), quiet: part.outline === false || !!part.hideWhileInspecting });
  if (!el.getClientRects().length) return (k.self = null);
  const kind = objectKind(el, c.win);
  // The map's own top layers stay on top: a box around them that the map doesn't list (a page wrapper with a fill) is
  // the page, not a thing. What was picked from the page inside it doesn't count: a dock stays a thing when its
  // light becomes a layer.
  if (!kind || (!el.parentElement?.closest(ANY) && [...el.querySelectorAll(ANY)].some((x) => ofTheMap(x.getAttribute(TAG))))) return (k.self = null);
  return (k.self = { el, layer: null, kind, quiet: false });
}
// The things right under an element: the nearest ones down every branch, in page order
function kidsOf(el: Element, c: Ctx): Thing[] {
  const k = keptOf(el, c);
  if (k.kids) return k.kids;
  const out: Thing[] = [];
  let n = 0;
  const walk = (parent: Element) => {
    for (let ch = parent.firstElementChild; ch && n < MAX; ch = ch.nextElementSibling) {
      n++;
      const t = thingOf(ch, c);
      if (t) out.push(t);
      else if (!(ch as SVGElement).ownerSVGElement) walk(ch);
    }
  };
  read(() => walk(el));
  return (k.kids = out);
}
// Whether anything under an element is a thing (a row's chevron): stops at the first
function hasInside(el: Element, c: Ctx): boolean {
  const k = keptOf(el, c);
  if (k.has !== undefined) return k.has;
  if (k.kids) return (k.has = k.kids.length > 0);
  let n = 0;
  const walk = (parent: Element): boolean => {
    for (let ch = parent.firstElementChild; ch && n < MAX; ch = ch.nextElementSibling) {
      n++;
      if (thingOf(ch, c) || (!(ch as SVGElement).ownerSVGElement && walk(ch))) return true;
    }
    return false;
  };
  return (k.has = read(() => walk(el)));
}
// The things an element sits in, outermost first, and itself last when it is one. Quiet layers are left out unless
// asked for (the list has rows for them; picking passes through them).
function chainOf(el: Element, c: Ctx, quiet = false): Thing[] {
  const out: Thing[] = [];
  for (let a: Element | null = el; a && a !== c.doc.body && a !== c.doc.documentElement; a = a.parentElement) {
    const t = thingOf(a, c);
    if (t && (quiet || !t.quiet)) out.unshift(t);
  }
  return out;
}

function targetOf(t: Thing, c: Ctx): Target | null {
  if (t.layer) {
    const part = partById(t.layer);
    return part ? { key: t.layer, layer: t.layer, label: part.label, kind: t.kind, el: t.el, els: elementsOf(c.doc, t.layer) } : null;
  }
  const k = keptOf(t.el, c);
  if (k.target !== undefined) return k.target;
  const d = describe(t.el, t.kind);
  return (k.target = d ? { key: d.part.id, layer: null, label: d.part.label, kind: t.kind, el: t.el, els: [t.el], object: d } : null);
}

// --- What is under a point of the site's viewport

const rectOf = (el: Element) => el.getBoundingClientRect();
function holds(el: Element, x: number, y: number): 0 | 1 | 2 {
  const r = rectOf(el);
  if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return 2;
  const pad = r.height < 12 || r.width < 12 ? SLACK : 0;
  return pad && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad ? 1 : 0;
}
// Whether a thing is what a person sees at the point. It is shown at all, by the same reading the outlines use
// (presence.ts: on screen and inside what clips it, not hidden or faint, not only words nobody can see yet), its
// words show, and nothing solid is painted over it there. `stack`: what the browser hits at the point, topmost first.
// A thing that lets clicks through can't be asked that way and counts as seen where its shown box holds the point;
// one that takes clicks and isn't hit there is clipped away at the point.
function showsAt(t: Thing, x: number, y: number, stack: readonly Element[], win: Window): boolean {
  const el = t.el;
  const seen = shownRects(el as HTMLElement, win.document, win, { cover: false }).rects[0];
  if (!seen) return false;
  if ((t.kind === "text" || t.kind === "button") && !wordsShow(el)) return false;
  if (holds(el, x, y) === 1) return true; // beside a thin thing, by a few pixels
  const at = stack.findIndex((s) => s === el || el.contains(s));
  if (at < 0) {
    if (win.getComputedStyle(el).pointerEvents !== "none") return false;
    if (x < seen.x - 1 || x > seen.x + seen.w + 1 || y < seen.y - 1 || y > seen.y + seen.h + 1) return false;
    // A veil over the whole screen that lets clicks through (grain, a vignette) and that the map doesn't list would
    // be what every click on an empty place picks: it is picked from the list
    return !!t.layer || seen.w * seen.h < 0.9 * win.innerWidth * win.innerHeight;
  }
  for (let j = 0; j < at; j++) if (!stack[j].contains(el) && paintsOver(stack[j], el, win)) return false;
  return true;
}

// The things under a point, outermost first: the smallest thing a person sees there, and the things it sits in.
// Looked for from the top down by box (so what lets clicks through is found), and from what the browser hits there
// up (so what hangs outside the box of the thing it sits in is found too).
export function chainAt(win: Window, x: number, y: number): Thing[] {
  const doc = win.document;
  if (!doc.body) return [];
  const c = ctxOf(win);
  const stack = doc.elementsFromPoint(x, y);
  const found = new Map<Element, Thing>();
  const down = (list: Thing[], depth: number) => {
    for (const t of list) {
      if (!holds(t.el, x, y)) continue;
      if (!t.quiet) found.set(t.el, t);
      if (depth < DEPTH) down(kidsOf(t.el, c), depth + 1);
    }
  };
  down(kidsOf(doc.body, c), 0);
  for (const s of stack.slice(0, 12)) {
    const t = chainOf(s, c).pop();
    if (t) found.set(t.el, t);
  }
  const area = (t: Thing) => {
    const r = rectOf(t.el);
    return r.width * r.height;
  };
  const sized = [...found.values()].map((t) => ({ t, area: area(t) })).sort((a, b) => a.area - b.area || (a.t.el.contains(b.t.el) ? 1 : -1));
  const asked = new Map<Thing, boolean>();
  const shows = (t: Thing) => asked.get(t) ?? (asked.set(t, showsAt(t, x, y, stack, win)), asked.get(t) as boolean);
  let leaf = sized.find((s) => shows(s.t));
  // Things of about one size that aren't one inside the other (stacked screens, a full-screen canvas behind a
  // full-screen section): the one the browser hits first there, which is the one painted on top
  if (leaf) {
    const smallest = leaf;
    const hit = (s: { t: Thing }) => {
      const i = stack.findIndex((e) => e === s.t.el || s.t.el.contains(e));
      return i < 0 ? Infinity : i;
    };
    for (const s of sized) {
      if (s.area > smallest.area * 1.1) break;
      if (s === smallest || s.t.el.contains(smallest.t.el) || smallest.t.el.contains(s.t.el) || !shows(s.t)) continue;
      if (hit(s) < hit(leaf)) leaf = s;
    }
  }
  // The smallest thing seen there, and then whatever is seen inside it: a thing may be bigger than the thing it sits
  // in (a portrait hanging out of its small round holder)
  for (let inner = leaf; inner; leaf = inner) {
    const within: Element = inner.t.el;
    inner = sized.find((s) => s.t.el !== within && within.contains(s.t.el) && shows(s.t));
    if (!inner) break;
  }
  return leaf ? chainOf(leaf.t.el, c) : [];
}

function sameBox(a: Element, b: Element): boolean {
  const p = rectOf(a);
  const q = rectOf(b);
  const w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
  const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
  if (w <= 0 || h <= 0) return false;
  return (w * h) / (p.width * p.height + q.width * q.height - w * h) >= SAME;
}
// A chain as steps a person takes: things of about one box in a row (a card and the picture that fills it, a section
// and the wrapper that fills it) are one step, the outer one, or the one the map lists. `at`: the step each thing of
// the chain is part of.
function steps(chain: readonly Thing[]): { list: Thing[]; at: number[] } {
  const list: Thing[] = [];
  const at: number[] = [];
  for (const t of chain) {
    const last = list[list.length - 1];
    if (last && sameBox(last.el, t.el)) {
      if (t.layer && !last.layer) list[list.length - 1] = t;
    } else list.push(t);
    at.push(list.length - 1);
  }
  return { list, at };
}

// Whether the outermost thing at a place is a section, with blocks inside it, or is itself a block. A section is one
// the map calls a section, a <section>, <header>, <footer>, <nav> or <main>, or anything about as wide as the page.
// Anything else at the top is a block: a card or a dock outside every section, a layer of a map that has no
// sections (a click on it used to pick a part inside it, and the thing itself was reached only on its own space).
const WIDE = 0.9; // of the page's width
const SECTION_TAG = /^(section|header|footer|nav|main)$/;
function isSection(t: Thing): boolean {
  if (t.kind === "section" || SECTION_TAG.test(t.el.localName)) return true;
  const page = t.el.ownerDocument.defaultView?.innerWidth ?? 0;
  return page > 0 && rectOf(t.el).width >= WIDE * page;
}
// The step that is the block, in steps outermost first: the one under the section, or the first when it isn't one
const blockStep = (list: readonly Thing[]) => (list.length && isSection(list[0]) ? 1 : 0);

// What a click picks, given the things under the pointer (chainAt) and the block the person is inside (scopeOf):
//   - inside that block: the thing right under it there, or the block itself on its own space;
//   - anywhere else: the block, which is the thing right under the section there, or the section on its own space;
//     where the outermost thing isn't a section, it is the block;
//   - deep (⌘ held): the smallest thing there.
export function pickAt(chain: readonly Thing[], scope: readonly Element[], deep = false): Thing | null {
  if (!chain.length) return null;
  if (deep) return chain[chain.length - 1];
  let k = -1;
  chain.forEach((t, i) => {
    if (scope.includes(t.el)) k = i;
  });
  if (k >= 0) return insideAt(chain, [chain[k].el]) ?? chain[k];
  const s = steps(chain).list;
  return s[blockStep(s)] ?? s[0];
}
// One level in from a thing, at the point (a double-click on it): the thing right under it there. Something that
// fills it (a picture as big as its card) is reached when nothing smaller is there.
export function insideAt(chain: readonly Thing[], of: readonly Element[]): Thing | null {
  let k = -1;
  chain.forEach((t, i) => {
    if (of.includes(t.el)) k = i;
  });
  if (k < 0) return null;
  return steps(chain.slice(k)).list[1] ?? chain[k + 1] ?? null;
}

// Where a picked thing stands: the things it sits in as steps, and which step it is
function standing(el: Element, c: Ctx): { list: Thing[]; step: number } {
  const chain = chainOf(el, c);
  // A quiet layer isn't in the chain: it stands where its place would be
  const whole = chain[chain.length - 1]?.el === el ? chain : [...chain, { el, layer: layerIdOf(el), kind: "frame" as PartKind, quiet: true }];
  const s = steps(whole);
  return { list: s.list, step: s.at[s.at.length - 1] };
}
// The block a picked thing is inside, when it is deeper than a block (sections first, blocks second; a top thing
// that isn't a section is a block): the element
// around each of its elements. Its edge is drawn dashed, and clicks inside it pick at its level.
export function scopeOf(win: Window, els: readonly Element[]): Element[] {
  const c = ctxOf(win);
  const out = new Set<Element>();
  for (const el of els.slice(0, 24)) {
    if (!el.isConnected) continue;
    const { list, step } = standing(el, c);
    if (step > blockStep(list)) out.add(list[step - 1].el);
  }
  return [...out];
}
// One level up from a picked thing (Escape): the block it is inside, or null at block level and above
export function upFrom(win: Window, els: readonly Element[]): Target | null {
  const c = ctxOf(win);
  const el = els.find((x) => x.isConnected);
  if (!el) return null;
  const { list, step } = standing(el, c);
  return step > blockStep(list) ? targetOf(list[step - 1], c) : null;
}

// An element as something to pick (an Assets row: the picture or video it shows): the nearest thing at or around it
// that can be picked, the same way a click on it would end up
export function targetOfElement(win: Window, el: Element): Target | null {
  if (!el.isConnected) return null;
  return read(() => {
    const c = ctxOf(win);
    const chain = chainOf(el, c);
    for (let i = chain.length - 1; i >= 0; i--) {
      const t = targetOf(chain[i], c);
      if (t) return t;
    }
    return null;
  });
}

// A thing under the pointer as something to pick: itself, or, when it has no address (nothing around it is a layer
// the code is tagged for), the nearest thing around it that has one
export function targetAt(win: Window, chain: readonly Thing[], thing: Thing | null): Target | null {
  if (!thing) return null;
  const c = ctxOf(win);
  for (let i = chain.indexOf(thing); i >= 0; i--) {
    const t = targetOf(chain[i], c);
    if (t) return t;
  }
  return null;
}
// --- The list: the same tree, a level at a time

// A row: a layer of the map (part), or a thing the map doesn't list (target). kids: it has rows under it.
export type Row = { key: string; part: Part | null; target: Target | null; kids: boolean; holdsLayers: boolean };
const sized = (el: Element) => {
  const r = rectOf(el);
  return r.width >= MIN && r.height >= MIN;
};
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & 4); // b comes after a on the page

// The rows under a row (parent: a layer's id, or an object's element), or the top rows (both null). Layers come as
// the map and the page order them (parts.ts); the things the map doesn't list are put among them where they are on
// the page. A layer that sits inside such a thing is listed under it.
// The list is drawn again whenever the pointer moves onto another thing: a level's rows are kept, like everything
// else here, until the map or the page changes.
type KeptRows = { stamp: string; page: number; at: number; rows: Row[] };
const rowsByLayer = new Map<string, KeptRows>();
const rowsByObject = new WeakMap<Element, KeptRows>();
export function rowsUnder(doc: Document | null | undefined, layer: string | null, object: Element | null = null): Row[] {
  const win = doc?.defaultView;
  // No page yet: the layers as the map has them
  if (!doc?.body || !win) return object ? [] : childrenOf(layer).map((p) => rowOf(null, p));
  const c = ctxOf(win);
  const was = object ? rowsByObject.get(object) : rowsByLayer.get(layer ?? "");
  if (was && was.stamp === c.stamp && (was.page === c.page || c.now - was.at < floor)) return was.rows;
  const rows = read(() => readRows(doc, c, layer, object));
  const keep = { stamp: c.stamp, page: c.page, at: c.now, rows };
  if (object) rowsByObject.set(object, keep);
  else rowsByLayer.set(layer ?? "", keep);
  return rows;
}
function readRows(doc: Document, c: Ctx, layer: string | null, object: Element | null): Row[] {
  const roots = object ? [object] : layer ? elementsOf(doc, layer) : [doc.body];
  const found: Thing[] = [];
  const seen = new Set<Element>();
  for (const root of roots) for (const t of kidsOf(root, c)) if (!seen.has(t.el)) found.push(t), seen.add(t.el);
  const layerRow = (p: Part): Row => rowOf(doc, p);
  const objectRow = (t: Thing): Row | null => {
    const target = sized(t.el) ? targetOf(t, c) : null;
    return target && { key: target.key, part: null, target, kids: hasInside(t.el, c), holdsLayers: !!t.el.querySelector(ANY) };
  };
  if (object) {
    // Inside a thing the map doesn't list: what the page has there, in its order; a layer is listed where its first
    // element is
    const rows: Row[] = [];
    const listed = new Set<string>();
    for (const t of found) {
      const part = t.layer ? partById(t.layer) : undefined;
      if (part) {
        if (!listed.has(part.id) && elementsOf(doc, part.id)[0] === t.el) rows.push(layerRow(part)), listed.add(part.id);
      } else {
        const row = objectRow(t);
        if (row) rows.push(row);
      }
    }
    return rows;
  }
  // The layers the map and the page put here, except those that sit inside a thing the map doesn't list
  const under = (el: Element): boolean => {
    for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
      const t = thingOf(a, c);
      if (t) return !t.layer;
    }
    return false;
  };
  const layers = childrenOf(layer).filter((p) => {
    const first = elementsOf(doc, p.id)[0];
    return !first || !under(first);
  });
  const rows: Row[] = [];
  let next = 0;
  for (const t of found) {
    if (t.layer) continue;
    const row = objectRow(t);
    if (!row) continue;
    // Every layer that comes before it on the page first (one with no element here keeps its place among them)
    for (; next < layers.length; next++) {
      const first = elementsOf(doc, layers[next].id)[0];
      if (first && (follows(t.el, first) || t.el.contains(first))) break;
      rows.push(layerRow(layers[next]));
    }
    rows.push(row);
  }
  for (; next < layers.length; next++) rows.push(layerRow(layers[next]));
  return rows;
}
// A layer's own row
export function rowOf(doc: Document | null | undefined, p: Part): Row {
  const inside = childrenOf(p.id).length > 0;
  const win = doc?.defaultView;
  const c = doc?.body && win && p.id !== "site" ? ctxOf(win) : null;
  return { key: p.id, part: p, target: null, kids: inside || (!!c && elementsOf(doc, p.id).some((el) => hasInside(el, c))), holdsLayers: inside };
}
// The rows a thing sits under, outermost first (their keys): opened when it is picked on the page
export function rowsAbove(win: Window, el: Element): string[] {
  const c = ctxOf(win);
  return chainOf(el, c, true)
    .filter((t) => t.el !== el)
    .map((t) => targetOf(t, c)?.key)
    .filter((k): k is string => !!k);
}
