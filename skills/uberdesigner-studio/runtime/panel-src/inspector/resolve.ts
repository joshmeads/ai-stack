// The one place the panel looks a layer up on the site's page. Outlines, presence, picks, Play, text editing, live
// values and the Elements panel all ask here; nothing else queries the page for a layer.
//
// A layer is an address (server/address.ts). A tagged layer's elements already carry the inspector's attribute, written
// into the source by apply.mjs. An addressed layer (a CSS selector, for what the source can't tag) gets the same
// attribute put on its matching elements here, on the page only and never in the code, so every other lookup treats
// both kinds alike. The page is watched for changes (one observer per page): when elements come or go, or a class or
// id changes, the addresses are run again and the lists below are thrown away. A read first takes what the observer
// has seen and not yet reported, so an answer is never older than the page.
//
// An element carries one layer. An address that lands on an element that is already another layer is left out, and
// problemOf() says so.

import { TAG, selectorsOf, tagSelector, tagTargetsOf } from "../../server/address";
import { PARTS, mapRev, partById, perMap } from "./parts";

const ANY = `[${TAG}]`;
// The layers found by a selector, as the map has them now
const addressed = perMap(() => PARTS.map((p) => ({ id: p.id, selector: selectorsOf(p).join(", ") })).filter((a) => a.selector));

type State = {
  observer: MutationObserver;
  stale: boolean;
  changes: number; // how many times the page was seen to change (pageRev): what is worked out from it is kept until then
  rev: number; // the map the lists were made from (parts.ts mapRev)
  lists: Map<string, readonly HTMLElement[]>; // layer id -> its elements, until the page changes
  marked: Map<Element, string>; // elements this file put the attribute on, and for which layer
  problems: Map<string, string>;
};
const states = new WeakMap<Document, State>();

function stateOf(doc: Document): State {
  const known = states.get(doc);
  if (known) return known;
  const Observer = (doc.defaultView as unknown as { MutationObserver?: typeof MutationObserver } | null)?.MutationObserver ?? MutationObserver;
  const s: State = { observer: new Observer(() => void ((s.stale = true), s.changes++)), stale: true, changes: 0, rev: mapRev(), lists: new Map(), marked: new Map(), problems: new Map() };
  s.observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [TAG, "class", "id"] });
  states.set(doc, s);
  return s;
}

// Run the selector addresses again: mark what they match now, unmark what they no longer match
function resolve(doc: Document, s: State) {
  s.stale = false;
  s.lists.clear();
  if (!addressed().length && !s.marked.size) return;
  s.problems.clear();
  const want = new Map<Element, string>();
  for (const a of addressed()) {
    let hits: Element[];
    try {
      hits = [...doc.querySelectorAll(a.selector)];
    } catch {
      s.problems.set(a.id, `its address (${a.selector}) isn't a selector the browser can read`);
      continue;
    }
    for (const el of hits) {
      const has = el.getAttribute(TAG);
      const taken = has && has !== a.id && s.marked.get(el) !== has ? has : want.has(el) && want.get(el) !== a.id ? want.get(el) : null;
      if (taken) s.problems.set(a.id, `its address (${a.selector}) lands on an element that is already ${partById(taken)?.label ?? taken}: an element carries one layer`);
      else want.set(el, a.id);
    }
  }
  for (const [el, id] of s.marked) {
    if (want.get(el) === id) continue;
    // A layer that was found by its address and is tagged in the code now (a picked object that was kept): the mark
    // stays, it is what the file says
    const now = partById(id);
    if (!(now && !selectorsOf(now).length && tagTargetsOf(now).length) && el.getAttribute(TAG) === id) el.removeAttribute(TAG);
    s.marked.delete(el);
  }
  for (const [el, id] of want) {
    if (el.getAttribute(TAG) !== id) el.setAttribute(TAG, id);
    s.marked.set(el, id);
  }
  s.observer.takeRecords(); // its own marks aren't news
}

function ready(doc: Document): State {
  const s = stateOf(doc);
  if (s.observer.takeRecords().length) {
    s.stale = true;
    s.changes++;
  }
  // A newer map: its addresses are asked again
  if (s.rev !== mapRev()) {
    s.rev = mapRev();
    s.stale = true;
  }
  if (s.stale) resolve(doc, s);
  return s;
}

// Start watching a page (each time the editor's frame loads)
export function watchPage(doc: Document) {
  if (doc.documentElement) ready(doc);
}

// A number that goes up whenever elements came or went, or a class, an id or a layer's mark changed: anything worked
// out from the page's structure (tree.ts) is good until it does
export const pageRev = (doc: Document): number => ready(doc).changes;

// A layer's elements on the page now. Don't change the list: it's shared until the page changes.
export function elementsOf(doc: Document | null | undefined, id: string): readonly HTMLElement[] {
  if (!doc?.documentElement) return [];
  const s = ready(doc);
  let list = s.lists.get(id);
  if (!list) {
    list = [...doc.querySelectorAll<HTMLElement>(tagSelector(id))];
    s.lists.set(id, list);
  }
  return list;
}
export const elementOf = (doc: Document | null | undefined, id: string): HTMLElement | null => elementsOf(doc, id)[0] ?? null;
export const onPage = (doc: Document | null | undefined, id: string) => elementsOf(doc, id).length > 0;

// Every layer element on the page, in page order
export function layerElements(doc: Document): HTMLElement[] {
  ready(doc);
  return [...doc.querySelectorAll<HTMLElement>(ANY)];
}

// The layer an element belongs to: itself when it is one, else the nearest layer around it
export function layerAround(el: Element | null | undefined): HTMLElement | null {
  if (!el) return null;
  ready(el.ownerDocument);
  return el.closest<HTMLElement>(ANY);
}
export const isLayer = (el: Element) => el.hasAttribute(TAG);
// The layer elements inside an element (not the element itself)
export function layersInside(el: Element): HTMLElement[] {
  ready(el.ownerDocument);
  return [...el.querySelectorAll<HTMLElement>(ANY)];
}
export const layerIdOf = (el: Element | null | undefined): string | null => el?.getAttribute(TAG) ?? null;

// Whether an element is a layer's own: the layer's element itself, or inside it and not inside a layer nested in it
export const ownedBy = (layer: Element, el: Element) => el === layer || (!isLayer(el) && layerAround(el) === layer);

// Why a layer's address can't be used on this page, or null
export const problemOf = (doc: Document | null | undefined, id: string): string | null => (doc?.documentElement ? (ready(doc).problems.get(id) ?? null) : null);
