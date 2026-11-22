
// The project's map, written by the design-map skill (inspector.map.json at the project root): its parts, what the
// build prompt (or the code) says about each, the tokens that style it, and the files a change to it may touch.
// The dev server puts it on the page as window.__DESIGN_MAP__ along with the panel (see server/api.ts panelTags).
// Format: design-map/reference/map-format.md.

import { useSyncExternalStore } from "react";
import type { Target } from "../../server/address";

export type PromptRef = { where: string; text: string };
export type TokenKind = "color" | "size" | "em" | "ms" | "number" | "text";
// What a layer is, for its icon: the map can say it; otherwise the editor reads it from the element on the page
export const PART_KINDS = ["section", "frame", "text", "image", "video", "button", "icon", "scene", "list"] as const;
export type PartKind = (typeof PART_KINDS)[number];

// One setting of an effect: a number constant by name (const RISE = 0.07), or the number right after a piece of code
// written once in the file (find: "smoothstep(" in a shader)
// motion: a timing (duration, delay, distance of a move): listed under Animation instead of Effect; so is a unit of s or ms
export type Param = { file: string; name?: string; find?: string; nth?: number; label: string; min?: number; max?: number; step?: number; unit?: string; motion?: boolean };
export const isMotionParam = (p: Param) => !!p.motion || /^(m?s)$/.test(p.unit ?? "");
export const paramKey = (p: Param) => p.name ?? (p.nth ? `${p.find}#${p.nth}` : (p.find ?? ""));

export type Part = {
  id: string; // the layer's name in the code: data-dm="…" on its elements
  label: string;
  group: string;
  parent?: string; // the part it sits inside (its layer is nested under that one); its element is inside the parent's
  kind?: PartKind;
  params?: Param[]; // an effect's settings: numbers in its code, set from the panel
  added?: boolean; // added by a change in the inspector; shown while its tag is in the code
  picked?: boolean; // picked in the editor and kept (server/layers.ts): not a layer the map came with
  removed?: boolean; // removed by a change in the inspector; shown again if an undo brings its tag back
  prompt: PromptRef[];
  tokens: string[];
  content?: string[]; // keys in the words file, if the project has one
  files: string[]; // where it lives, for people (may carry notes in brackets)
  edit: string[]; // files a change to this part sends to Claude, picked by default
  note?: string;
  outline?: boolean; // false: listed but never outlined (full-screen or intro-only layers, objects inside a canvas)
  at?: number; // where it shows on a scroll story: scroll progress 0–1, or px; picking it scrolls there
  hideWhileInspecting?: boolean; // hidden while the panel is open (a custom cursor that follows the mouse)
  // Where it is: elements apply.mjs tagged in the source ({ file, find }), or a CSS selector asked of the page
  // ({ selector }) for what the source can't tag. None: listed for its values only (server/address.ts).
  targets?: Target[];
};

export type DesignMap = {
  version: 1;
  name: string;
  source?: { prompt?: string | null; template?: string | null; kind?: "prompt+code" | "code" | "prompt" };
  facts: string[]; // short lines about where things live; they go into every request to Claude
  tokensFile?: string | null;
  content?: { file: string; labels?: Record<string, string> } | null;
  extraFiles: string[];
  groups: string[];
  parts: Part[];
  tokens: Record<string, { kind: TokenKind; role: string; label?: string }>; // label: a plain name ("Body text size")
};

const EMPTY: DesignMap = { version: 1, name: "site", facts: [], extraFiles: [], groups: [], parts: [], tokens: {} };
// A field the map leaves out reads as empty: a map written by hand without "tokens" opened a blank editor
const whole = (given: Partial<DesignMap> | undefined): DesignMap =>
  given ? ({ ...given, ...Object.fromEntries(Object.entries(EMPTY).map(([k, v]) => [k, (given as Record<string, unknown>)[k] ?? v])) } as DesignMap) : { ...EMPTY };

// The map the editor works from. It arrives with the page, and a newer one is swapped in whenever the map changes on
// the server (a change added or removed a layer, an Undo, a restore, the skill applied a new map): replaceMap() fills
// the same objects again, so MAP, PARTS, GROUPS, TOKENS and EXTRA_FILES are always the map as it is now, for every
// module that imported them. Nothing may keep a table built from them at import: ask partById() or read them when
// needed, and a component that shows them re-renders on useMapRev().
export const MAP: DesignMap = whole((globalThis as unknown as { __DESIGN_MAP__?: Partial<DesignMap> }).__DESIGN_MAP__);
export const TOKENS: DesignMap["tokens"] = MAP.tokens;
export const EXTRA_FILES: string[] = MAP.extraFiles;
export const PARTS: Part[] = [];
export const GROUPS: string[] = [];

// Every map gets a "Whole site" entry: the one place for site-wide changes
const siteOf = (map: DesignMap): Part => ({
  id: "site",
  label: "Whole site",
  group: "Site",
  prompt: map.source?.template ? [{ where: "Template", text: `${map.name}, built from ${map.source.template}.` }] : [{ where: "Project", text: map.name }],
  tokens: [],
  // A Vite project's source folder; for a site with no build step, the files its parts live in
  files: map.parts.some((p) => p.edit.some((f) => /\.html?$/.test(f) && !f.startsWith("src/"))) ? [...new Set(map.parts.flatMap((p) => p.edit))] : ["src/", "index.html", "package.json"],
  edit: [],
  note: "Changes here run as a whole-project change: Claude Code reads what it needs, can add packages and files, and can change several parts at once.",
  outline: false,
});

// The layer tree: which layer sits in which, and in what order. The page decides for every layer it carries
// (setPageTree, read from the site's page by tree.ts): a layer's parent is the nearest layer its element sits in, and
// layers are listed in the order of their elements, so a change that moves or swaps things is followed with nothing
// to keep in step. The map's own "parent" and order hold for what the page can't say: a layer with no element here
// (another page, a hover photo, an object inside a canvas) keeps its place among its neighbours, and a layer stays in
// a parent that has no address at all (a group the map made up, a canvas scene's objects).
// With no nesting anywhere the list is the older flat one, under group folders.
export type PageTree = { index: Map<string, number>; parent: Map<string, string | null> }; // by layer id; index: place on the page
let byId = new Map<string, Part>();
// An object picked inside a layer and not kept (objects.ts): listed like a layer while it is picked, in the editor
// only. The map knows nothing of it until it is changed or kept.
let picked: Part | null = null;
let page: PageTree | null = null;
let nested = false;
let rev = 0;
const mapParent = (p: Part) => (p.parent && p.parent !== p.id && byId.has(p.parent) ? p.parent : undefined);
const noAddress = (id: string) => !(byId.get(id)?.targets?.length ?? 0);
function parentOf(p: Part): string | undefined {
  const authored = mapParent(p);
  if (!page?.index.has(p.id) || (authored && noAddress(authored))) return authored;
  const on = page.parent.get(p.id);
  return on && on !== p.id && byId.has(on) ? on : undefined;
}
// Neighbours in the order of the page: those on the page take each other's places in page order, the rest stay put
function inOrder(list: Part[]): Part[] {
  const at = page?.index;
  if (!at) return list;
  const there = list.filter((p) => at.has(p.id)).sort((x, y) => (at.get(x.id) as number) - (at.get(y.id) as number));
  let next = 0;
  return list.map((p) => (at.has(p.id) ? there[next++] : p));
}
function fill() {
  if (picked && MAP.parts.some((p) => p.id === picked?.id)) picked = null; // it is a layer of the map now
  PARTS.splice(0, PARTS.length, siteOf(MAP), ...MAP.parts.filter((p) => p.id !== "site"), ...(picked ? [picked] : []));
  // The map's groups, then any group a part names that the list leaves out (a section a change added)
  GROUPS.splice(0, GROUPS.length, ...new Set(["Site", ...MAP.groups, ...MAP.parts.map((p) => p.group)].filter(Boolean)));
  byId = new Map(PARTS.map((p) => [p.id, p]));
  nested = PARTS.some((p) => parentOf(p));
}
fill();

export const partById = (id: string | null | undefined): Part | undefined => (id ? byId.get(id) : undefined);
export const isNested = () => nested;
export const childrenOf = (id: string | null): Part[] => inOrder(PARTS.filter((p) => (parentOf(p) ?? null) === id && p.id !== "site"));
// A group's layers, for the flat list
export const inGroup = (group: string): Part[] => inOrder(PARTS.filter((p) => p.group === group));
// From the outermost layer down to the part's parent
export function ancestorsOf(id: string): Part[] {
  const out: Part[] = [];
  let p = byId.get(id);
  const seen = new Set<string>();
  while (p && parentOf(p) && !seen.has(p.id)) {
    seen.add(p.id);
    p = byId.get(parentOf(p) as string);
    if (p) out.unshift(p);
  }
  return out;
}

// --- The map changing while the editor is open

const listeners = new Set<() => void>();
export const subscribeMap = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
// A number that goes up each time a newer map is swapped in or the page's tree changes: a cache keyed on it is never
// older than either
export const mapRev = () => rev;
// For a component that shows the map: it renders again when a newer one is swapped in
export const useMapRev = () => useSyncExternalStore(subscribeMap, mapRev);
export const pickedObject = () => picked;
export const isPickedObject = (id: string | null | undefined) => !!id && picked?.id === id;
export function setPickedObject(next: Part | null) {
  if ((next?.id ?? null) === (picked?.id ?? null)) return;
  picked = next;
  fill();
  rev++;
  for (const fn of [...listeners]) fn();
}
// The picked object as the page has it now (Editor.tsx): its address found again after something changed beside it,
// its name after its words were typed over. The same object, the same id.
export function movePickedObject(selector: string, label: string) {
  if (!picked || (picked.targets?.[0]?.selector === selector && picked.label === label)) return;
  picked = { ...picked, label, targets: [{ selector }] };
  fill();
  rev++;
  for (const fn of [...listeners]) fn();
}
// What the site's page says about the layers now (null: no page read yet). Everything that lists layers follows.
export function setPageTree(next: PageTree | null) {
  page = next;
  nested = PARTS.some((p) => parentOf(p));
  rev++;
  for (const fn of [...listeners]) fn();
}
export function replaceMap(next: Partial<DesignMap>) {
  const map = whole(next);
  for (const k of Object.keys(TOKENS)) delete TOKENS[k];
  Object.assign(TOKENS, map.tokens);
  EXTRA_FILES.splice(0, EXTRA_FILES.length, ...map.extraFiles);
  for (const k of Object.keys(MAP)) delete (MAP as Record<string, unknown>)[k];
  Object.assign(MAP, map, { tokens: TOKENS, extraFiles: EXTRA_FILES });
  fill();
  rev++;
  for (const fn of [...listeners]) fn();
}
// A value worked out from the map, kept until the map changes
export function perMap<T>(make: () => T): () => T {
  let at = -1;
  let value: T;
  return () => {
    if (at !== rev) {
      value = make();
      at = rev;
    }
    return value;
  };
}

// What the element on the page is, when the map doesn't say: an image, a video, a canvas scene, a button or link,
// an icon, a frame holding other parts, else text
export function kindOf(part: Part, el: Element | null): PartKind {
  if (part.kind && (PART_KINDS as readonly string[]).includes(part.kind)) return part.kind;
  if (childrenOf(part.id).length) return part.parent ? "frame" : "section";
  // Not on the page (hover photos, objects inside a canvas): its name is all there is to go on
  if (!el) return /photo|image|picture|cover|portrait/i.test(part.label) ? "image" : /video|film|reel/i.test(part.label) ? "video" : /scene|3d|sphere|model|globe/i.test(part.label) ? "scene" : "frame";
  const tag = el.tagName.toLowerCase();
  if (tag === "img" || tag === "picture" || el.querySelector(":scope > img, :scope > picture")) return "image";
  if (tag === "video" || el.querySelector(":scope > video")) return "video";
  if (tag === "canvas" || el.querySelector(":scope > canvas")) return "scene";
  if (tag === "svg") return "icon";
  if (tag === "button" || tag === "a" || el.getAttribute("role") === "button") return "button";
  if (tag === "ul" || tag === "ol" || tag === "table") return "list";
  if (tag === "section" || tag === "header" || tag === "footer" || tag === "main" || tag === "nav") return "section";
  return (el.textContent ?? "").trim() ? "text" : "frame";
}
