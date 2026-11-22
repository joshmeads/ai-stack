// Whether a layer is really on screen, and where: the page moves (pinned and scrubbed stories, reveals letter by
// letter, intros, stacked screens), so a tagged element having a box isn't enough. A layer counts as shown when its
// box is at least 4 px each way inside the viewport and inside any clipping parent, the element isn't hidden or
// transparent, its own text isn't all transparent (a title hidden character by character), and something else isn't
// painted over it (tested at a few points, not for elements that let clicks through). Outlines, picks, the "hidden"
// marks, jumps and Play all use this. Plain DOM reads, no parser.

import { MAP, partById } from "./parts";
import { elementsOf, layerAround, layerIdOf, layersInside } from "./resolve";
import { notAState } from "./switches";

export type Rect = { x: number; y: number; w: number; h: number };
export type Shown = { rects: Rect[]; why: string | null }; // why: in plain words, when nothing is shown

const MIN = 4; // px: thinner than this on either side is a collapsed element (a folded menu), unless it's a line
const COVER_MS = 400; // the cover test is the costly part: once per element in this long
const covers = new WeakMap<Element, { at: number; by: string | null }>();

const clip = (r: Rect, c: Rect): Rect => {
  const x = Math.max(r.x, c.x);
  const y = Math.max(r.y, c.y);
  return { x, y, w: Math.min(r.x + r.w, c.x + c.w) - x, h: Math.min(r.y + r.h, c.y + c.h) - y };
};

// The box as a designer sees it: a turned element keeps its own size around its centre (its bounding box would
// breathe as it turns). Its own size as it is drawn, so scaled too (by itself or by what it sits in): worked back
// from the box around it and the angle, with the proportions of its layout box.
function boxOf(el: HTMLElement, win: Window): Rect {
  const r = el.getBoundingClientRect();
  const t = win.getComputedStyle(el).transform;
  const m = t && t !== "none" ? t.match(/matrix\(([^)]+)\)/) : null;
  if (m) {
    const [a, b] = m[1].split(",").map(Number);
    if (Math.abs(b) > 0.01 && el.offsetWidth && el.offsetHeight) {
      const angle = Math.atan2(b, a);
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      const ratio = el.offsetWidth / el.offsetHeight;
      // The box around it is (w·cos + h·sin) wide and (w·sin + h·cos) tall, with w = h·ratio
      const h = (r.width / (ratio * cos + sin) + r.height / (ratio * sin + cos)) / 2;
      const w = h * ratio;
      return { x: r.left + r.width / 2 - w / 2, y: r.top + r.height / 2 - h / 2, w, h };
    }
  }
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// The elements holding this layer's own text (not text inside a nested layer), the first `max` of them
export function ownTextElements(el: Element, max = 60): Element[] {
  const out = new Set<Element>();
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n && out.size < max; n = walker.nextNode()) if (n.textContent?.trim() && n.parentElement && layerAround(n.parentElement) === el) out.add(n.parentElement);
  return [...out];
}

export const visibleNow = (el: Element) => (el as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
// As good as transparent: faded to under a tenth through itself and what it sits in (a card at the far side of a
// turning ring, a line on its way out). Not hidden as far as the browser goes, and nothing a person can see or pick.
const FAINT = 0.1;
export function faint(el: Element, win: Window): boolean {
  let seen = 1;
  for (let a: Element | null = el; a && seen > FAINT; a = a.parentElement) seen *= Number(win.getComputedStyle(a).opacity) || 0;
  return seen <= FAINT;
}
// Whether an element has a box inside the viewport (text only screen readers get, a 1 px "visually hidden" copy of a
// title split into letters, has none worth the name)
export const onScreen = (el: Element, win: Window) => {
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < win.innerHeight && r.right > 0 && r.left < win.innerWidth;
};

// Whether what a layer has on screen is words nobody can see yet (a title hidden letter by letter until its reveal):
// it has words of its own on screen, none of them can be seen, and nothing else of it shows there either (a picture, a
// video, a drawing, a box with a fill or a border, words of a layer inside it). Only what is on screen counts: a
// section that shows its scenes in turn keeps most of its words transparent at any moment, and is on screen all the
// same. Asked at most every TEXT_MS per element (outlines measure every frame); the list of its text elements is kept
// LIST_MS, and is whole up to WORDS_MAX (a long story has a couple of thousand).
const TEXT_MS = 300;
const LIST_MS = 3000;
const WORDS_MAX = 2500;
const PAINT_MAX = 4000; // elements of a layer looked at for something that paints
const MEDIA = "img, video, canvas, svg, picture";
type Words = { at: number; listed: number; leaves: Element[]; seen: boolean; waiting: boolean; hidden: boolean | null };
const textCache = new WeakMap<Element, Words>();
// A layer's own words where they are now: some can be seen on screen (seen), some are on screen and can't (waiting)
function wordsOf(el: Element, win: Window): Words {
  const now = performance.now();
  const c = textCache.get(el);
  if (c && now - c.at < TEXT_MS) return c;
  const fresh = !c || now - c.listed >= LIST_MS;
  const leaves = fresh ? ownTextElements(el, WORDS_MAX) : c.leaves;
  let waiting = false;
  let seen = false;
  for (const t of leaves) {
    if (visibleNow(t)) {
      if ((seen = onScreen(t, win))) break;
    } else if (!waiting) waiting = onScreen(t, win);
  }
  const w: Words = { at: now, listed: fresh ? now : c.listed, leaves, seen, waiting, hidden: null };
  textCache.set(el, w);
  return w;
}
function wordsHidden(el: Element, win: Window): boolean {
  const w = wordsOf(el, win);
  return (w.hidden ??= w.waiting && !w.seen && !showsMore(el, win));
}
// Whether a box paints something of its own: a fill, a background picture, a border
export function paints(el: Element, win: Window): boolean {
  const s = win.getComputedStyle(el);
  const alpha = (c: string) => (c === "transparent" ? 0 : (/^rgba|\//.test(c) ? (c.match(/[\d.]+/g)?.map(Number)[3] ?? 1) : 1));
  if (/url\(|gradient\(/.test(s.backgroundImage) || alpha(s.backgroundColor) > 0.05) return true;
  return s.borderTopStyle !== "none" && parseFloat(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0.05;
}
// Whether a layer shows something on screen besides its own words
function showsMore(el: Element, win: Window): boolean {
  if (el.matches(MEDIA) || paints(el, win)) return true;
  let n = 0;
  for (const d of el.querySelectorAll("*")) {
    if (++n > PAINT_MAX) break;
    if (!onScreen(d, win) || !visibleNow(d)) continue;
    if (d.matches(MEDIA) || paints(d, win)) return true;
  }
  return layersInside(el).some((inner) => visibleNow(inner) && onScreen(inner, win) && wordsOf(inner, win).seen);
}

// Whether the element on top (or a box around it, up to what it shares with el) paints a solid fill: an opaque
// background colour, an image or a video, not faded below 90%
const SOLID_TAGS = new Set(["IMG", "VIDEO", "PICTURE"]);
// A gradient whose colours are all opaque is a fill like any other (a card painted pink to purple hides what is
// behind it); one that fades to nothing anywhere is a veil, and what is under it stays in view
const solidGradient = (image: string) => /gradient\(/.test(image) && !/transparent|rgba\(|\/\s*[\d.]+%?\s*\)/.test(image);
export function paintsOver(hit: Element, el: Element, win: Window): boolean {
  const chain: Element[] = [];
  for (let a: Element | null = hit; a && !a.contains(el); a = a.parentElement) chain.push(a);
  let opacity = 1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = win.getComputedStyle(chain[i]);
    opacity *= +s.opacity;
    if (opacity < 0.9) return false;
    const bg = s.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    const alpha = /^rgba|\//.test(s.backgroundColor) ? (bg[3] ?? 1) : bg.length ? 1 : 0;
    if ((bg.length && alpha >= 0.9 && s.backgroundColor !== "transparent") || SOLID_TAGS.has(chain[i].tagName) || /url\(/.test(s.backgroundImage) || solidGradient(s.backgroundImage)) return true;
  }
  return false;
}

// What's painted over the element at a few points of its box, or null when the element (or something inside it) is
// what shows there. Elements that let clicks through (pointer-events: none) can't be tested this way: never covered.
function coveredBy(el: HTMLElement, r: Rect, doc: Document, win: Window): string | null {
  const cached = covers.get(el);
  const now = performance.now();
  if (cached && now - cached.at < COVER_MS) return cached.by;
  let by: string | null = null;
  if (win.getComputedStyle(el).pointerEvents !== "none") {
    const points = [
      [0.5, 0.5],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ].map(([fx, fy]) => [r.x + r.w * fx, r.y + r.h * fy]);
    const hits = points.map(([x, y]) => doc.elementFromPoint(x, y)).filter((h): h is Element => !!h);
    // Covered only where what's on top paints something solid: a see-through layer over it (a gradient that fades
    // out, a ripple canvas, text over a photo) leaves it in view
    if (hits.length && !hits.some((h) => h === el || el.contains(h) || h.contains(el)) && hits.every((h) => paintsOver(h, el, win))) {
      const top = hits[0];
      const id = layerIdOf(layerAround(top));
      by = id ? (partById(id)?.label ?? id) : `<${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ""}>`;
    }
  }
  covers.set(el, { at: now, by });
  return by;
}

// The parents that clip an element's content (overflow other than visible), worked out once a second
const clipCache = new WeakMap<Element, { at: number; list: Element[] }>();
function clippers(el: Element, doc: Document, win: Window): Element[] {
  const now = performance.now();
  const c = clipCache.get(el);
  if (c && now - c.at < 1000) return c.list;
  const list: Element[] = [];
  for (let p = el.parentElement, n = 0; p && p !== doc.body && n < 20; p = p.parentElement, n++) {
    const s = win.getComputedStyle(p);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") list.push(p);
  }
  clipCache.set(el, { at: now, list });
  return list;
}

// An SVG line or path's box leaves out its stroke (a horizontal <line> is 0 px tall): its painted stroke is added to
// the short side, scaled the way the drawing is
function lineBox(el: Element, r: Rect, win: Window): Rect {
  const Geometry = (win as unknown as { SVGGeometryElement?: typeof SVGGeometryElement }).SVGGeometryElement;
  if (!Geometry || !(el instanceof Geometry) || (r.w >= MIN && r.h >= MIN)) return r;
  const s = win.getComputedStyle(el);
  if (s.stroke === "none" || !s.stroke) return r;
  const ctm = (el as SVGGeometryElement).getScreenCTM();
  const stroke = (parseFloat(s.strokeWidth) || 1) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
  if (r.h < stroke) r = { ...r, y: r.y + r.h / 2 - stroke / 2, h: stroke };
  if (r.w < stroke) r = { ...r, x: r.x + r.w / 2 - stroke / 2, w: stroke };
  return r;
}

// Where an element is shown now (its visible boxes), or why it isn't
export function shownRects(el: HTMLElement, doc: Document, win: Window, opts: { cover?: boolean } = {}): Shown {
  if (!el.isConnected) return { rects: [], why: "not on the page" };
  if (!el.getClientRects().length) return { rects: [], why: "not displayed (display: none, or a parent is)" };
  if (!visibleNow(el) || faint(el, win)) return { rects: [], why: "transparent or hidden (opacity 0 or visibility: hidden), maybe waiting for an intro or a reveal" };
  let r = lineBox(el, boxOf(el, win), win);
  // A line (a 1 px rule, a progress track, an SVG stroke) is shown however thin it is on screen: a stage scaled to fit
  // makes a 1 px divider 0.8 px. A box that clips its content to under MIN is a collapsed one (a folded menu).
  const clipsContent = el instanceof (win as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement && (el.scrollHeight > el.clientHeight + MIN || el.scrollWidth > el.clientWidth + MIN);
  const thin = (r.w < MIN || r.h < MIN) && r.w > 0 && r.h > 0 && Math.max(r.w, r.h) >= 8 && !clipsContent;
  const min = thin ? 0.01 : MIN;
  if (r.w < min || r.h < min) return { rects: [], why: `collapsed (${Math.round(r.w)} × ${Math.round(r.h)} px): open it in Preview` };
  // Inside the viewport and inside every parent that clips its content
  r = clip(r, { x: 0, y: 0, w: win.innerWidth, h: win.innerHeight });
  for (const p of clippers(el, doc, win)) {
    const c = p.getBoundingClientRect();
    r = clip(r, { x: c.left, y: c.top, w: c.width, h: c.height });
  }
  if (r.w < min || r.h < min) return { rects: [], why: "outside the screen at this scroll position" };
  // Asked only of a layer that is on screen: it reads the layer's words where they are now
  if (wordsHidden(el, win)) return { rects: [], why: "its words are transparent (revealed later, letter by letter or on scroll)" };
  if (opts.cover !== false) {
    const by = coveredBy(el, r, doc, win);
    if (by) return { rects: [], why: `covered by ${by}` };
  }
  return { rects: [{ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }], why: null };
}

// A layer (all its tagged elements): its shown boxes, or the first reason none is shown
export function shownPart(id: string, doc: Document, win: Window): Shown {
  const els = elementsOf(doc, id);
  if (!els.length) return { rects: [], why: "not on this page" };
  const all = els.map((el) => shownRects(el, doc, win));
  const rects = all.flatMap((s) => s.rects);
  return rects.length ? { rects, why: null } : { rects: [], why: all[0].why };
}

// --- What the page switches on its layers while it runs (an intro's data-ready, a reveal's .in-view, a custom
// data-waiting): recorded from when the editor's frame loads, so Play can switch exactly those off and on again,
// whatever the site calls them

export type Switch = { el: Element; kind: "attr" | "class"; name: string; value: string | null };
const recorded = new WeakMap<Document, Map<string, Switch[]>>();

export function recordSwitches(doc: Document) {
  const win = doc.defaultView;
  if (!win || recorded.has(doc)) return;
  const map = new Map<string, Switch[]>();
  recorded.set(doc, map);
  const Observer = (win as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;
  const obs = new Observer((list) => {
    for (const m of list) {
      const el = m.target as Element;
      if (m.type !== "attributes" || !m.attributeName || notAState(m.attributeName)) continue;
      const part = layerIdOf(layerAround(el));
      if (!part) continue;
      const items = map.get(part) ?? [];
      if (m.attributeName === "class") {
        const before = new Set((m.oldValue ?? "").split(/\s+/).filter(Boolean));
        for (const c of el.classList) if (!before.has(c) && !items.some((s) => s.el === el && s.kind === "class" && s.name === c)) items.push({ el, kind: "class", name: c, value: null });
      } else if (el.hasAttribute(m.attributeName) && !items.some((s) => s.el === el && s.kind === "attr" && s.name === m.attributeName)) {
        items.push({ el, kind: "attr", name: m.attributeName, value: el.getAttribute(m.attributeName) });
      }
      map.set(part, items.slice(-24));
    }
  });
  obs.observe(doc.documentElement, { subtree: true, attributes: true, attributeOldValue: true });
}

// What was switched on a layer, or on the layers around it, since the page loaded (still switched on now)
export function switchesFor(doc: Document, ids: string[]): Switch[] {
  const map = recorded.get(doc);
  if (!map) return [];
  return ids.flatMap((id) => map.get(id) ?? []).filter((s) => (s.kind === "class" ? s.el.classList.contains(s.name) : s.el.getAttribute(s.name) === s.value));
}

// --- Bringing a layer into view. The page moves (pinned and scrubbed stories, reveals, loops), so "where is it shown"
// has no answer in the code: the page is asked, and what it answers is remembered.
//
// 1. What was seen is remembered. The outlines measure every layer every frame, so as the person scrolls the panel
//    learns at which scroll position each layer shows; a search that finds one records it too. Kept per page and
//    viewport width, in the browser's storage, so the next jump goes straight there. A recorded place that no longer
//    shows the layer is simply looked for again.
// 2. A search has a contract. One search at a time; a new pick ends the one under way. It has a time budget, and at
//    the limit the answer is "not found in time", with a way to keep looking: it is allowed not to know. Every way
//    out except "shown" puts the page back where the search began (unless the person took the page over by hand).
// 3. "Settled" means the page has stopped responding to the scroll: the scroll position holds, no reveal that ends is
//    still running on the layer, and the layer's own look has stopped changing. A layer that moves forever (a walking
//    spider, a marquee) never stops changing, so it is only checked for "shown", never waited on to be still.


const frames = (win: Window, n: number) => new Promise<void>((done) => {
  const step = (k: number) => (k ? win.requestAnimationFrame(() => step(k - 1)) : done());
  step(n);
});

// What the panel has seen: layer -> the scroll position where it showed best (the largest area), and the layers a full
// search didn't find. For one page at one viewport width.
type Seen = { y: number; area: number };
let seenFor = "";
let seen = new Map<string, Seen>();
let missed = new Set<string>();
let saving = 0;
const seenKey = (win: Window) => `design-inspector:seen:${MAP.name}:${win.location.pathname}:${win.innerWidth}`;
function recall(win: Window) {
  const key = seenKey(win);
  if (key === seenFor) return;
  seenFor = key;
  seen = new Map();
  missed = new Set();
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? "{}") as { seen?: Record<string, Seen>; missed?: string[] };
    for (const [id, v] of Object.entries(kept.seen ?? {})) if (typeof v?.y === "number") seen.set(id, v);
    for (const id of kept.missed ?? []) missed.add(id);
  } catch {
    /* nothing kept, or storage is off: the session's own memory still works */
  }
}
function keepSoon() {
  if (saving) return;
  saving = window.setTimeout(() => {
    saving = 0;
    try {
      localStorage.setItem(seenFor, JSON.stringify({ seen: Object.fromEntries(seen), missed: [...missed] }));
    } catch {
      /* storage is full or off */
    }
  }, 1500);
}
// Called by the outlines whenever what is on screen changes: each layer shown now, with its boxes
export function noteShown(win: Window, boxes: { id: string; rects: Rect[] }[]) {
  recall(win);
  const y = Math.round(win.scrollY);
  for (const b of boxes) {
    if (!b.rects.length) continue;
    const area = b.rects.reduce((n, r) => n + r.w * r.h, 0);
    const was = seen.get(b.id);
    // The place where most of it showed; a place about as good replaces an older one (the page may have changed)
    if (!was || area >= was.area * 0.9) {
      if (!was || was.y !== y || was.area !== area) {
        seen.set(b.id, { y, area });
        keepSoon();
      }
    }
    if (missed.delete(b.id)) keepSoon();
  }
}

// How a layer looks at this instant (its first boxes, its opacity and its first words' opacity), to tell whether it
// is still changing
function lookOf(id: string, doc: Document, win: Window): string {
  return elementsOf(doc, id)
    .slice(0, 3)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const leaf = ownTextElements(el)[0];
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)},${win.getComputedStyle(el).opacity},${leaf ? win.getComputedStyle(leaf).opacity : ""}`;
    })
    .join("|");
}
type Animated = Element & { getAnimations?: (o?: { subtree?: boolean }) => Animation[] };
const animationsOf = (id: string, doc: Document) => elementsOf(doc, id).slice(0, 3).flatMap((el) => (el as Animated).getAnimations?.({ subtree: true }) ?? []);
const endless = (a: Animation) => (a.effect?.getComputedTiming().iterations ?? 1) === Infinity;
// A reveal that will end is still on its way (running, or waiting out its delay)
const revealing = (id: string, doc: Document) => animationsOf(id, doc).some((a) => a.playState === "running" && !endless(a));
const movesForever = (id: string, doc: Document) => animationsOf(id, doc).some((a) => a.playState === "running" && endless(a));

type Search = { restless: boolean; gone: () => boolean };
const SAMPLE_MS = 40; // between two looks at the layer while the page settles
const STILL = 3; // looks in a row with nothing changing: the page has stopped responding to the scroll
const FLOOR_MS = 180; // never decided sooner than this after a scroll

// After a scroll: true as soon as the layer shows. False once the page has settled and it still doesn't, or at the cap.
// patient: for a layer that moves by itself, wait out the whole cap (it may only show at some moments of its loop).
async function settle(id: string, doc: Document, win: Window, cap: number, search: Search, patient = false): Promise<boolean> {
  const t0 = performance.now();
  await frames(win, 2);
  let lastY = win.scrollY;
  let last = lookOf(id, doc, win);
  let still = 0;
  let looks = 0;
  let changes = 0;
  for (;;) {
    if (search.gone()) return false;
    if (!shownPart(id, doc, win).why) return true;
    const elapsed = performance.now() - t0;
    if (elapsed >= cap) return false;
    await new Promise((done) => setTimeout(done, SAMPLE_MS));
    await frames(win, 1);
    const y = win.scrollY;
    const now = lookOf(id, doc, win);
    looks++;
    if (now !== last) changes++;
    // Changing at every look for a third of a second, with nothing that ends driving it: it moves by itself
    if (!search.restless && looks >= 6 && changes === looks && !revealing(id, doc)) search.restless = true;
    const quiet = y === lastY && (search.restless || now === last) && !revealing(id, doc);
    still = quiet ? still + 1 : 0;
    lastY = y;
    last = now;
    if (still >= STILL && performance.now() - t0 >= FLOOR_MS && !(search.restless && patient)) return !shownPart(id, doc, win).why;
  }
}

// Fixed or sticky bars at the top of the viewport cover a section's top after a jump
function topBars(doc: Document, win: Window): number {
  let h = 0;
  for (const x of doc.elementsFromPoint(win.innerWidth / 2, 2)) {
    const s = win.getComputedStyle(x);
    if ((s.position === "fixed" || s.position === "sticky") && x.getBoundingClientRect().top <= 2 && x.getBoundingClientRect().height < win.innerHeight / 3) h = Math.max(h, x.getBoundingClientRect().bottom);
  }
  return h;
}

// The scroll range a pinned stage covers: the sticky element's parent, or GSAP's pin spacer, from the moment it
// pins to the moment it lets go
function pinnedRange(el: Element, doc: Document, win: Window): [number, number] | null {
  for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
    const s = win.getComputedStyle(p);
    const spacer = p.parentElement?.classList.contains("pin-spacer") ? p.parentElement : null;
    const holder = spacer ?? (s.position === "sticky" ? p.parentElement : null);
    if (holder) {
      const top = holder.getBoundingClientRect().top + win.scrollY;
      return [Math.max(0, top - win.innerHeight * 0.1), Math.max(top, top + holder.offsetHeight - win.innerHeight)];
    }
  }
  return null;
}

// A layer far taller than the screen (the track a pinned story scrolls along, a long section) shows somewhere along
// its own height, not always at its top: the scene before may still fill the screen there
function ownRange(el: Element, win: Window): [number, number] | null {
  const r = el.getBoundingClientRect();
  if (r.height < win.innerHeight * 1.5) return null;
  const top = Math.max(0, r.top + win.scrollY);
  return [top, top + r.height - win.innerHeight];
}

function fixedOverlay(el: Element, doc: Document, win: Window): boolean {
  for (let p: Element | null = el; p && p !== doc.body; p = p.parentElement) if (win.getComputedStyle(p).position === "fixed") return true;
  return false;
}

export type At = number | undefined; // the map's "at": scroll progress 0–1, or px

// How a search ended
export type Arrival =
  | { state: "shown" }
  | { state: "not-here"; why: string } // it can't show here: not on this page, not displayed at this size
  | { state: "not-found"; why: string; more: boolean } // not found (in time); more: a longer look can be asked for
  | { state: "cancelled" };

const BUDGET_MS = 4000; // a sweep's time before it answers "not found in time"
const FINE_MS = 3000; // more for a pinned stage's half-steps: a sweep going at its normal pace finishes inside both
const THOROUGH_MS = 20000; // when the person asks to keep looking
const DIRECT_CAP = 1400; // at the layer's own place: reveals on scroll get this long to arrive
const KNOWN_CAP = 900; // at a place it was seen before
const STEP_CAP = 900; // at each step of a sweep

let running: { cancel: (by: "pick" | "hand") => void; done: Promise<void> } | null = null;
// End the search under way. "hand": the person took the page over (scrolled, clicked on it): it stays where it is.
export const cancelSearch = (by: "pick" | "hand" = "hand") => running?.cancel(by);

// Bring a layer to where it shows. thorough: the person asked to keep looking (a longer, finer sweep).
export async function bringTo(id: string, doc: Document, win: Window, at: At, opts: { thorough?: boolean } = {}): Promise<Arrival> {
  // One search at a time: a new one ends the one under way, which first puts the page back
  if (running) {
    running.cancel("pick");
    await running.done;
  }
  let cancelled: "pick" | "hand" | null = null;
  let finish = () => undefined as void;
  const mine = { cancel: (by: "pick" | "hand") => void (cancelled ??= by), done: new Promise<void>((ok) => (finish = ok)) };
  running = mine;
  const start = win.scrollY;
  const go = (y: number) => win.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
  const byHand = () => mine.cancel("hand");
  win.addEventListener("wheel", byHand, { passive: true });
  win.addEventListener("touchmove", byHand, { passive: true });
  win.addEventListener("keydown", byHand);
  let arrival = { state: "cancelled" } as Arrival;
  let swept = false; // the page was stepped through: put it back unless the layer was found
  try {
    recall(win);
    const search: Search = { restless: movesForever(id, doc), gone: () => cancelled !== null };
    const els = elementsOf(doc, id);
    const el = els.find((x) => x.getClientRects().length) ?? els[0];
    const done = (a: Arrival) => (arrival = search.gone() ? { state: "cancelled" } : a);
    const found = (): Arrival => {
      missed.delete(id);
      noteShown(win, [{ id, rects: shownPart(id, doc, win).rects }]);
      return { state: "shown" };
    };
    if (!el) return done({ state: "not-here", why: "it isn't on this page" });
    // Not displayed at all (a phone-only button at desktop size): scrolling won't give it a box, so don't search
    if (!el.getClientRects().length) return done({ state: "not-here", why: shownPart(id, doc, win).why ?? "not displayed" });
    const max = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
    const arrive = async (y: number, cap: number, patient = false) => {
      go(y);
      return settle(id, doc, win, cap, search, patient);
    };
    // 1. Where the map says it shows
    if (at !== undefined) {
      const ok = await arrive(at <= 1 ? at * max : at, DIRECT_CAP, true);
      return done(ok ? found() : { state: "not-here", why: shownPart(id, doc, win).why ?? "not shown where the map says" });
    }
    // 2. Where it was seen before
    const known = seen.get(id);
    if (known && (await arrive(Math.min(known.y, max), KNOWN_CAP))) return done(found());
    if (search.gone()) return done(arrival);
    // 3. An ordinary page: the element in the middle, or a tall one from its top, below any fixed bar
    const r = el.getBoundingClientRect();
    const bars = topBars(doc, win);
    const own = r.height > win.innerHeight - bars ? win.scrollY + r.top - bars - 8 : win.scrollY + r.top + r.height / 2 - win.innerHeight / 2;
    if (await arrive(own, DIRECT_CAP, true)) return done(found());
    if (search.gone()) return done(arrival);
    // 4. It has a box here and still isn't shown. Where scroll can't be what shows it (not inside a pinned stage, not
    // taller than the screen itself, not fixed to the screen), stepping through the page finds nothing: say why, and
    // offer the long look.
    const why = shownPart(id, doc, win).why ?? "not shown";
    const pinned = pinnedRange(el, doc, win) ?? ownRange(el, win);
    const fixed = !pinned && fixedOverlay(el, doc, win);
    if (!opts.thorough) {
      if (missed.has(id)) return done({ state: "not-found", why: `${why}. It wasn't found anywhere on this page last time`, more: true });
      if (!pinned && !fixed) return done({ state: "not-found", why: `${why}. It may only show in some state of the page`, more: true });
    }
    // 5. A scroll story: step through it within the budget. Coarse steps first, then the half-steps in between for a
    // pinned stage (a layer may only show briefly) or when asked to keep looking.
    swept = true;
    const t0 = performance.now();
    const budget = opts.thorough ? THOROUGH_MS : pinned ? BUDGET_MS + FINE_MS : BUDGET_MS;
    const range = pinned ?? [0, max];
    const STEPS = 10;
    const stepY = (k: number) => Math.round(range[0] + ((range[1] - range[0]) * k) / STEPS);
    for (const k of [...Array(STEPS + 1).keys(), ...(pinned || opts.thorough ? Array.from({ length: STEPS }, (_, i) => i + 0.5) : [])]) {
      if (search.gone()) return done(arrival);
      if (performance.now() - t0 > budget) return done({ state: "not-found", why: `${why}. Not found in ${Math.round(budget / 1000)} s of looking`, more: !opts.thorough });
      if (Math.abs(stepY(k) - own) < 16) continue; // tried in 3
      if (await arrive(stepY(k), STEP_CAP)) return done(found());
    }
    if (search.gone()) return done(arrival);
    missed.add(id);
    keepSoon();
    return done({ state: "not-found", why: `${why}. Not shown anywhere on this page`, more: !opts.thorough });
  } finally {
    win.removeEventListener("wheel", byHand);
    win.removeEventListener("touchmove", byHand);
    win.removeEventListener("keydown", byHand);
    // Every way out of a sweep except "shown" puts the page back where the search began, unless the person took it over
    if (swept && arrival.state !== "shown" && cancelled !== "hand") go(start);
    if (running === mine) running = null;
    finish();
  }
}
