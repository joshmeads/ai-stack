import { api, apiDirect, beforeWrites } from "./api";
import { isKey } from "./keys";
import { tokenLabel } from "./tokenNames";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GROUPS, MAP, PARTS, TOKENS, ancestorsOf, childrenOf, inGroup, isNested, isPickedObject, kindOf, movePickedObject, partById, perMap, pickedObject, replaceMap, setPageTree, setPickedObject, useMapRev, type DesignMap, type Part, type PartKind } from "./parts";
import { LayerIcon } from "./LayerIcon";
import { Totals } from "./Totals";
import { DeleteLayer, LayerExtras, PlayButton } from "./LayerExtras";
import { replay } from "./play";
import { bringTo, cancelSearch, recordSwitches, type Arrival } from "./presence";
import { isEasing } from "./EasingControl";
import { inheritedFor, type Inherited } from "./inherited";
import { ensureFont, findFont, firstFamily, type FontFamily } from "./fonts";
import { useWords, wordLabel, type Words } from "./words";
import { TokenControl } from "./TokenControl";
import { valueProblem } from "./valueCheck";
import { History } from "./History";
import { Assets } from "./Assets";
import { About, MARK } from "./About";
import { mergePages, pagePath, type SitePage } from "./pages";
import { readPartTokens, readTokens, ALIAS } from "./tokenValues";
import { Activity } from "./Activity";
import { active, markLoaded, useJobs, type Job, type Jobs } from "./jobs";
import { describe, sameAs, type Facts } from "./objects";
import { forgetTree, layerTarget, readTree, rowOf, rowsAbove, rowsUnder, targetOfElement, upFrom, type Row, type Target } from "./tree";
import { MapBehind, useMapCheck } from "./MapBehind";
import { NarrowCover } from "./NarrowCover";
import { ChatBar } from "./ChatBar";
import { LatestChange } from "./LatestChange";
import { DEFAULT_SETTINGS, type Settings } from "./change";
import { setTheme, useTheme } from "./theme";
import { EDITOR_PATH, pointAtFrame, reloadInPlace, reloadSite, takeScrollBack } from "./site";
import { ReloadBar } from "./ReloadBar";
import { Outlines, type Marks, type Pins } from "./Outlines";
import { numbersFor } from "./numbers";
import { beginTextEdit, fitTextBox, type TextBox, type TextEdit } from "./textEdit";
import { useShield } from "./shield";
import { elementOf, elementsOf, onPage, pageRev, problemOf, watchPage } from "./resolve";
import { inertTokens, useObservations, type Inert } from "./observe";
import { tellDirect, type DirectOut, type Offer, type Say } from "./directEdit";
import { ruleSelector, selectorsOf, tagSelector, tagTargetsOf } from "../../server/address";
import styles from "./Inspector.module.css";
import e from "./Editor.module.css";

// The editor, laid out like Figma: layers on the left, the site in the middle at a chosen viewport size, and on the
// right two tabs: Elements (the values of the picked layer and the site's global tokens) and AI changes (a card per
// change Claude makes). The chat bar for asking Claude sits under the site; starting a change opens AI changes, and a
// dot on that tab says something is running or waiting to be kept or undone. The site runs in a frame (same origin),
// so its own code, scroll and media queries behave as they would at that width, and the editor reads and outlines its
// parts from outside.
//
// The mouse over the site picks things (the wheel still scrolls the site): a click picks the block under the pointer,
// a double-click goes inside it, a double-click on words types over them, Escape goes up one level (Outlines.tsx,
// tree.ts). The list on the left is the same tree. Preview hands the mouse to the site, as a visitor would use it;
// holding Option does the same for a moment.

type Device = "phone" | "tablet" | "desktop" | "large";
const DEVICES: Record<Device, { label: string; w: number; h: number }> = {
  large: { label: "Desktop XL", w: 1920, h: 1080 },
  desktop: { label: "Desktop", w: 1440, h: 900 },
  tablet: { label: "Tablet", w: 768, h: 1024 },
  phone: { label: "Phone", w: 390, h: 844 },
};
const DEVICE_IDS = Object.keys(DEVICES) as Device[]; // largest first, as the toolbar and the preview's menu list them

// The two ways to work. Focus: the site, the request bar and the changes, nothing else to read. Design: the layers
// on the left and the picked layer's values on the right as well. Picking, the request bar and the cards are the same
// in both. The choice is kept for the site's address; a site opened for the first time starts in Focus.
type Mode = "focus" | "design";
const MODE_KEY = "uberdesigner-studio-mode";
function rememberedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "design" ? "design" : "focus";
  } catch {
    return "focus";
  }
}

const NO_MARKS: Marks = {};
const NO_PINS: Pins = {};
// Room around the frame in the middle: its label above it, the chat bar below it
const GAP = 24;
const LABEL = 26;
const BAR = 104;

type Tab = "pages" | "layers" | "assets" | "history";
type RightTab = "elements" | "changes" | "resolved";
// picked: the picked thing when the map doesn't list it (its layer as it would be, and what tells it apart), so the
// selection is still on it after the editor itself is reloaded
type Remembered = { selected: string | null; trying: boolean; device: Device; tab: Tab; rightTab: RightTab; collapsed: string[]; picked?: { part: Part; facts: Facts } | null };
const STORE = `design-inspector:editor:${MAP.name}`;
function remember(): Remembered {
  const fallback: Remembered = { selected: null, trying: false, device: "desktop", tab: "layers", rightTab: "elements", collapsed: [] };
  try {
    const r = { ...fallback, ...(JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Remembered>) };
    return DEVICES[r.device] ? r : { ...r, device: "desktop" };
  } catch {
    return fallback;
  }
}

const LOADED_AT = Date.now();
// The requests that change the site: one of these for an object that was only picked makes it a layer first
const CHANGES = /^\/__inspector\/(run|save|text|link|media|motion|param)(\?|$)/;
// When the map this page arrived with was last changed (the server's clock): a later one is fetched
const MAP_AT = (globalThis as unknown as { __DESIGN_MAP_AT__?: number }).__DESIGN_MAP_AT__ ?? 0;
// "Explore 500+ Prompts" under the chat bar: uberdesigner's library, opened in a new tab after asking. Tagged so the
// site's analytics know the visit came from the skill (the same shape as the MCP's links); the popup shows it untagged.
const PROMPTS_URL = "https://uberdesigner.ai/library?utm_source=uberdesigner-skill&utm_medium=skill&utm_campaign=explore-prompts";
const params = new URLSearchParams(location.search);
const START_PATH = params.get("path") || "/";
const START_PART = params.get("part");

// Parts hidden while inspecting (a custom cursor), as one style rule for the site's page
const hiddenCss = perMap(() =>
  PARTS.filter((p) => p.hideWhileInspecting)
    .map((p) => `html[data-inspect] ${tagSelector(p.id)} { display: none !important; }`)
    .join("\n"),
);
function hideWhileInspecting(doc: Document) {
  let tag = doc.getElementById("design-inspector-hidden");
  if (!tag && hiddenCss()) {
    tag = doc.createElement("style");
    tag.id = "design-inspector-hidden";
    doc.head.appendChild(tag);
  }
  if (tag && tag.textContent !== hiddenCss()) tag.textContent = hiddenCss();
}

// Layers that have an address (a tag in the code, or a selector): the ones the page can be asked for
const addressed = perMap(() => PARTS.filter((p) => p.id !== "site" && (p.targets?.length ?? 0) > 0));
// The files those tags are in, for "this isn't the page the map describes"
const taggedFiles = perMap(() => [...new Set(addressed().flatMap((p) => tagTargetsOf(p).map((t) => t.file ?? "")))].filter(Boolean));
const SETTLE_MS = 1500; // after the frame loads, before saying a layer isn't on the page (the site is still drawing)
const LOAD_PATIENCE_MS = 12000; // after the frame loads, before saying the picked thing is gone (an intro may still be playing)

// Why a layer that has an address isn't on the page, in plain words; null when it's there, or has no address at all
// (a piece inside a canvas, listed for its values)
function whyNotFound(part: Part, doc: Document | null | undefined): string | null {
  if (part.id === "site" || !part.targets?.length || !doc || onPage(doc, part.id)) return null;
  const problem = problemOf(doc, part.id);
  if (problem) return `${part.label}: ${problem}`;
  const selectors = selectorsOf(part);
  if (selectors.length) return `Nothing on this page matches the address of ${part.label} (${selectors.join(", ")})`;
  const tags = tagTargetsOf(part);
  const forwarded = tags.find((t) => t.forwards);
  if (forwarded) return `${part.label} is tagged in the code on a component (${forwarded.file}), but nothing on the page carries the tag: the component may not pass it on. The map can give this layer a selector address instead`;
  return `${part.label} is tagged in the code${tags[0]?.file ? ` (${tags[0].file})` : ""}, but nothing on this page carries the tag now`;
}

// Tokens the site's own code sets on <html> at startup: they win over the tokens file, so the editor shows them,
// resets to them, and warns that saving to the file won't change what's on screen
function siteSetTokens(doc: Document): Record<string, string> {
  const out: Record<string, string> = {};
  const style = doc.documentElement.style;
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (name.startsWith("--")) out[name] = style.getPropertyValue(name).trim();
  }
  return out;
}

// Global tokens in groups: the prompt's own section when its role says one ("Colors › ink: …"), else by kind
const KIND_GROUP: Record<string, string> = { color: "Colours", size: "Sizes", em: "Letter spacing", ms: "Timing", number: "Numbers", text: "Other" };
const tokenGroups = perMap((): [string, string[]][] => {
  const by = new Map<string, string[]>();
  for (const [name, meta] of Object.entries(TOKENS)) {
    const head = meta.role.includes("›") ? meta.role.split("›")[0].trim() : "";
    const group = head && head.length <= 28 ? head : (KIND_GROUP[meta.kind] ?? "Other");
    by.set(group, [...(by.get(group) ?? []), name]);
  }
  return [...by.entries()];
});

// Space, arrows, Page Up/Down, Home and End scroll the site even while the editor has focus: the key goes to the site
// first (sites that turn keys into slides listen for it), and if nothing there takes it, the page scrolls
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"]);
const ARROW_PX = 40;
const PAGE_SHARE = 0.875; // of the viewport, as browsers do
function keyScroll(frame: HTMLIFrameElement, ev: KeyboardEvent): boolean {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) return false;
  const KeyCtor = (win as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const forwarded = new KeyCtor("keydown", { key: ev.key, code: ev.code, shiftKey: ev.shiftKey, bubbles: true, cancelable: true });
  if (!(doc.activeElement ?? doc.body).dispatchEvent(forwarded)) return true;
  const page = win.innerHeight * PAGE_SHARE;
  if (ev.key === "Home") win.scrollTo({ top: 0, behavior: "smooth" });
  else if (ev.key === "End") win.scrollTo({ top: doc.documentElement.scrollHeight, behavior: "smooth" });
  else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") win.scrollBy({ top: ev.key === "ArrowDown" ? ARROW_PX : -ARROW_PX, behavior: "instant" as ScrollBehavior });
  else win.scrollBy({ top: ev.key === "PageUp" || (ev.key === " " && ev.shiftKey) ? -page : page, behavior: "smooth" });
  return true;
}

// What you picked, kept like a browser's history: picking something new drops anything "forward" of where you are
const PICKS_KEPT = 50;
function usePicks(first: string | null) {
  const [nav, setNav] = useState<{ list: (string | null)[]; at: number }>({ list: [first], at: 0 });
  const select = useCallback(
    (id: string | null) =>
      setNav((n) => {
        if (n.list[n.at] === id) return n;
        const list = [...n.list.slice(0, n.at + 1), id].slice(-PICKS_KEPT);
        return { list, at: list.length - 1 };
      }),
    [],
  );
  const back = useCallback(() => setNav((n) => (n.at > 0 ? { ...n, at: n.at - 1 } : n)), []);
  const forward = useCallback(() => setNav((n) => (n.at < n.list.length - 1 ? { ...n, at: n.at + 1 } : n)), []);
  return {
    selected: nav.list[nav.at] ?? null,
    select,
    back,
    forward,
    backId: nav.at > 0 ? nav.list[nav.at - 1] : undefined,
    forwardId: nav.at < nav.list.length - 1 ? nav.list[nav.at + 1] : undefined,
  };
}

export function Editor() {
  // What was picked last time, with the thing itself when the map doesn't list it: it is listed and found by its
  // address again, as it was while it was picked
  const start = useMemo(() => {
    const kept = remember();
    if (!START_PART && kept.picked && kept.selected === kept.picked.part.id && !partById(kept.selected)) setPickedObject(kept.picked.part);
    return kept;
  }, []);
  const { selected, select: setSelected, back, forward, backId, forwardId } = usePicks(START_PART ?? start.selected);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [hover, setHover] = useState<Target | null>(null); // the one thing under the pointer, on the page or on a row of the list
  const [device, setDevice] = useState<Device>(start.device);
  const [tab, setTab] = useState<Tab>(start.tab);
  const theme = useTheme();
  const [mode, setModeState] = useState<Mode>(rememberedMode);
  const setMode = (next: Mode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private window: it holds until the editor is reloaded */
    }
  };
  const [about, setAbout] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>(start.rightTab);
  const [exploring, setExploring] = useState(false); // asking before opening uberdesigner's prompt library
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(start.collapsed));
  // Rows that hold no layer of the map (a thing the map doesn't list, a layer with only such things inside) start
  // closed: opened by hand, or when something inside is picked
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [pageN, setPageN] = useState(0); // goes up when the page's structure changed: the list's rows are read again
  const [trying, setTrying] = useState(start.trying);
  // Preview is a full view of the site: the editor's columns and bars step aside and the frame fills the window (or
  // takes a chosen size). It is the same frame, so the page, its scroll and the picked layer are all still there on
  // the way back. Holding Option, and typing over words, hand the mouse to the site in place, as before.
  const [previewSize, setPreviewSize] = useState<"window" | Device>("window");
  const [option, setOption] = useState(false);
  // Typing over a text on the page: the mouse goes to the site meanwhile, so the caret and selection work there
  const [editingText, setEditingText] = useState(false);
  const [textBox, setTextBox] = useState<TextBox | null>(null); // split words: typed in a box over them instead
  const passThrough = trying || option || editingText;
  const textBoxRef = useRef(textBox);
  textBoxRef.current = textBox;
  const fittedBox = useRef<TextBox | null>(null); // the box whose words were sized to the text it covers (once each)
  // The button does what it says, whatever put the page in preview: the switch, an Option key the editor still takes
  // for held, or words being typed over (their typing ends its own way: the words are kept)
  const togglePreview = () => {
    if (!passThrough) return setTrying(true);
    setTrying(false);
    setOption(false);
    const typing = frameRef.current?.contentDocument?.activeElement as HTMLElement | null;
    if (typing?.isContentEditable) typing.blur();
    if (!textBoxRef.current) setEditingText(false);
  };
  const tryingRef = useRef(trying);
  tryingRef.current = trying;
  const togglePreviewRef = useRef(togglePreview);
  togglePreviewRef.current = togglePreview;
  const [visibleKey, setVisibleKey] = useState(""); // the parts on screen, as the outlines last measured them
  const visible = useMemo(() => new Set(visibleKey.split(",")), [visibleKey]);
  // Each layer's kind (text, image, button…), read from its element once the site has drawn it
  const [kinds, setKinds] = useState<Record<string, PartKind>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const editsRef = useRef(edits);
  editsRef.current = edits;
  // The footer's line, and at most one thing to do about it (Undo a direct edit, ask Claude for one that couldn't be
  // written). Saying anything new drops the offer of the line before.
  const [status, setStatusText] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const setStatus = useCallback<Say>((text, action) => {
    setStatusText(text);
    setOffer(text && action ? action : null);
  }, []);
  const [version, setVersion] = useState(0); // bumped after every change, save and restore: History re-reads
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [siteSet, setSiteSet] = useState<Record<string, string>>({});
  const [sitePath, setSitePath] = useState(START_PATH);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [manual, setManual] = useState<string[] | null>(null);
  const [replyTo, setReplyTo] = useState<Job | null>(null);
  // "Add new object" puts the start of a request in the chat bar (for the picked layer, or the whole site)
  const [chatSeed, setChatSeed] = useState<{ text: string; n: number } | null>(null);
  // (the chip beside the box shows which layer it goes into; Claude tags the new object and it joins the layers)
  const addObject = () => {
    setReplyTo(null);
    setChatSeed((s) => ({ text: "Add ", n: (s?.n ?? 0) + 1 }));
  };
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 900, h: 700 });

  const w = useWords(version);
  const jobs = useJobs(bump);
  const workingIds = new Set(jobs.jobs.filter((j) => j.state === "running" && j.partId).map((j) => j.partId as string));
  const queuedIds = new Set(jobs.jobs.filter((j) => j.state === "queued" && j.partId).map((j) => j.partId as string));
  const changedIds = new Set(jobs.threads.filter((t) => t.changed && !t.kept && t.latest.partId && !workingIds.has(t.latest.partId)).map((t) => t.latest.partId as string));
  const siteBusy = jobs.jobs.some((j) => j.mode === "project" && j.state === "running");
  const beforeId = jobs.threads.find((t) => t.id === jobs.comparing?.thread)?.latest.partId ?? null;
  // What the outlines mark on the site, kept as the same object while it doesn't change (so they don't redraw)
  const marksKey = JSON.stringify([...workingIds, "|", ...queuedIds, "|", ...changedIds, "|", beforeId]);
  const marks = useMemo<Marks>(() => {
    const m: Marks = {};
    changedIds.forEach((id) => (m[id] = "changed"));
    queuedIds.forEach((id) => (m[id] = "queued"));
    workingIds.forEach((id) => (m[id] = "working"));
    if (beforeId && m[beforeId]) m[beforeId] = "before";
    return m;
  }, [marksKey]);
  // The numbered pins over the site: one for each change still waiting on a part (running, or made and not yet kept
  // or undone), with the number its card carries. A whole-site change has a card and a number, and no pin.
  const numbers = numbersFor(jobs.threads);
  const pinsKey = JSON.stringify(
    jobs.threads
      .filter((t) => !t.resolved && (t.active || t.changed) && t.latest.mode !== "project" && t.latest.partId)
      .map((t) => [t.latest.partId, numbers.get(t.id) ?? 0, t.id]),
  );
  const pins = useMemo<Pins>(() => {
    const m: Pins = {};
    for (const [part, n, thread] of JSON.parse(pinsKey) as [string, number, string][]) (m[part] ??= []).push({ n, thread });
    Object.values(m).forEach((list) => list.sort((a, b) => a.n - b.n));
    return m;
  }, [pinsKey]);
  // A pin pressed: its card, in AI changes, brought into view and lit for a moment
  const showCard = useCallback((thread: string) => {
    setRightTab("changes");
    window.setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`article[data-thread="${thread}"]`);
      card?.scrollIntoView({ block: "nearest" });
      card?.animate([{ boxShadow: "0 0 0 2px #7548d9" }, { boxShadow: "0 0 0 2px rgba(117, 72, 217, 0)" }], { duration: 1400, easing: "ease-out" });
    }, 60);
  }, []);
  // Asked again after every change that finishes, every Undo (or "Use this one") and every save or restore: layers an
  // undone change had added are gone from the code, and their rows must go with them, not wait for a reload
  const mapCheck = useMapCheck(`${jobs.jobs.filter((j) => !active(j)).length}:${jobs.jobs.filter((j) => j.undone).length}:${version}`);
  const untaggedNow = useMemo(() => new Set(mapCheck?.absent ?? []), [mapCheck]); // removed or added parts with no tag in the code
  // The map changed on the server since the one this editor holds (a change added or removed a layer, an Undo, a
  // restore, the skill applied a new map): it is read again and swapped in (parts.ts). Nothing reloads: the list, the
  // outlines and the fields follow. Only if it can't be read is a reload offered.
  const mapN = useMapRev();
  const mapSeen = useRef(MAP_AT);
  const [mapUnread, setMapUnread] = useState(false);
  useEffect(() => {
    if (!jobs.mapAt || jobs.mapAt === mapSeen.current) return;
    let wanted = true;
    api("/__inspector/map")
      .then((r) => r.json() as Promise<{ ok: boolean; map?: DesignMap; at?: number }>)
      .then((d) => {
        if (!wanted) return;
        if (!d.ok || !d.map) throw new Error("no map");
        mapSeen.current = d.at ?? jobs.mapAt;
        replaceMap(d.map);
        setMapUnread(false);
      })
      .catch(() => wanted && setMapUnread(true));
    return () => {
      wanted = false;
    };
  }, [jobs.mapAt]);
  // A pick whose layer the newer map no longer has is let go
  useEffect(() => {
    if (selected && !partById(selected)) setSelected(null);
  }, [mapN, selected, setSelected]);

  const [tokensCss, setTokensCss] = useState("");
  const base = useMemo(() => readTokens(tokensCss), [tokensCss]);
  const partSaved = useMemo(() => readPartTokens(tokensCss, PARTS), [tokensCss, mapN]);
  // Values changed for one layer only, not saved yet: { partId: { token: value } }
  const [partEdits, setPartEdits] = useState<Record<string, Record<string, string>>>({});
  const partEditsRef = useRef(partEdits);
  partEditsRef.current = partEdits;
  // Google fonts picked in this session: loaded into the site now, added to the page's <head> on Save
  const [pickedFonts, setPickedFonts] = useState<Set<string>>(() => new Set());
  const pickedFontsRef = useRef(pickedFonts);
  pickedFontsRef.current = pickedFonts;
  const pickFont = useCallback((f: FontFamily) => {
    ensureFont(frameRef.current?.contentDocument, f);
    setPickedFonts((s) => (s.has(f.family) ? s : new Set([...s, f.family])));
  }, []);
  useEffect(() => {
    if (!MAP.tokensFile) return;
    api("/__inspector/tokens")
      .then((r) => r.json() as Promise<{ css: string }>)
      .then((d) => setTokensCss(d.css))
      .catch(() => setTokensCss(""));
  }, [version]);

  useEffect(() => {
    try {
      const object = pickedObject();
      const picked = object && object.id === selected && pickedFacts.current?.id === object.id ? { part: object, facts: pickedFacts.current } : null;
      localStorage.setItem(STORE, JSON.stringify({ selected, trying, device, tab, rightTab, collapsed: [...collapsed], picked } satisfies Remembered));
    } catch {
      /* private mode: the editor just won't remember its layout */
    }
  }, [selected, trying, device, tab, rightTab, collapsed, mapN]);

  // A change started (from the chat bar, a card's refinement, a layer's own buttons) opens AI changes, once per change;
  // one that finishes while you're on Elements only lights the dot
  const opened = useRef(new Set<string>());
  useEffect(() => {
    const started = jobs.jobs.filter((j) => active(j) && j.queuedAt > LOADED_AT && !opened.current.has(j.id));
    if (!started.length) return;
    started.forEach((j) => opened.current.add(j.id));
    setRightTab("changes");
  }, [jobs.jobs]);
  const needsYou = jobs.threads.some((t) => t.active || (t.changed && !t.kept));

  // A new layer starts with its own files picked automatically
  useEffect(() => {
    setManual(null);
    setReplyTo(null);
  }, [selected]);

  // The middle area's size, to fit the frame
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The frame's size: the picked device's while editing; in the full preview, the whole middle area ("Window") or
  // the size picked there
  const full = trying;
  const dev = !full ? DEVICES[device] : previewSize === "window" ? { label: "Window", w: Math.max(320, Math.round(stage.w)), h: Math.max(240, Math.round(stage.h)) } : DEVICES[previewSize];
  const availW = full ? Math.max(120, stage.w) : Math.max(120, stage.w - GAP * 2);
  const availH = full ? Math.max(120, stage.h) : Math.max(120, stage.h - LABEL - GAP - BAR);
  const scale = Math.min(1, availW / dev.w, availH / dev.h);
  const frameLeft = Math.round((stage.w - dev.w * scale) / 2);
  const frameTop = full ? Math.round(Math.max(0, (stage.h - dev.h * scale) / 2)) : Math.round(LABEL + GAP / 2 + Math.max(0, (availH - dev.h * scale) / 2));

  // The pointer moving says whether Option is held too (in the editor and in the site's frame)
  const heldOption = useCallback((ev: MouseEvent) => setOption((held) => (held === ev.altKey ? held : ev.altKey)), []);
  // Keys, in the editor and in the site's frame: Option tries the page for a moment, Escape drops the pick
  const onKey = useCallback(
    (ev: KeyboardEvent) => {
      // Option, as the event itself says it is held or not: a release the editor never heard (the key let go while
      // another window or a screenshot tool had the keyboard) would otherwise leave the page in preview for good
      setOption(ev.altKey);
      if (ev.type !== "keydown") return;
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
      // ⌘[ and ⌘] (Ctrl on Windows) step back and forward through what you picked, as in a browser
      if ((ev.metaKey || ev.ctrlKey) && (isKey(ev, "[") || isKey(ev, "]"))) {
        ev.preventDefault();
        stepRef.current(isKey(ev, "[") ? -1 : 1);
        return;
      }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === "Escape") {
        if (tryingRef.current) return void togglePreviewRef.current(); // out of the full preview, back to the editor
        upRef.current(); // up one level; at block level, nothing is picked
      }
      // Scrolling keys pressed in the editor reach the site (pressed in the site, they work there already)
      if (ev.view === window && SCROLL_KEYS.has(ev.key) && !(ev.key === " " && t?.closest?.("button, a, summary"))) {
        const frame = frameRef.current;
        if (frame && keyScroll(frame, ev)) ev.preventDefault();
      }
    },
    [],
  );
  useEffect(() => {
    const blur = () => setOption(false);
    window.addEventListener("mousemove", heldOption);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("mousemove", heldOption);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", blur);
    };
  }, [onKey]);
  const keyRef = useRef(onKey);
  keyRef.current = onKey;

  // Each time the frame loads (first load, Replay, a link inside the site, a reload after a change)
  const frameLoadedAt = useRef(Date.now());
  const [loads, setLoads] = useState(0); // frame loads, for what reads the page once per load (Assets)
  const [pages, setPages] = useState<SitePage[]>([]); // the site's pages found so far (pages.ts): the Pages tab, when 2+
  const onFrameLoad = () => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!frame || !doc || !win) return;
    pointAtFrame(frame);
    markLoaded();
    frameLoadedAt.current = Date.now();
    setLoads((n) => n + 1);
    setPages((p) => mergePages(p, doc));
    // What the page switches on its layers from now on (an intro's data-ready, a reveal's class), for Play
    recordSwitches(doc);
    // Its layers are looked up from here on (resolve.ts): tagged elements, and what the selector addresses match
    watchPage(doc);
    setFoundKey(null);
    // The page was reloaded to show something (Play, a change that needed it): back to where it was once its intro has
    // settled (some sites scroll to the top on load)
    const keep = takeScrollBack();
    if (keep !== null) {
      for (const ms of [300, 900, 1800]) win.setTimeout(() => win.scrollTo({ top: keep, behavior: "instant" as ScrollBehavior }), ms);
    }
    setSiteSet(siteSetTokens(doc));
    doc.documentElement.dataset.inspect = "on";
    hideWhileInspecting(doc);
    // Live edits not saved yet stay on screen
    for (const [name, value] of Object.entries(editsRef.current)) doc.documentElement.style.setProperty(name, value);
    pickedFontsRef.current.forEach((family) => {
      const f = findFont(family);
      if (f) ensureFont(doc, f);
    });
    for (const [id, vals] of Object.entries(partEditsRef.current))
      elementsOf(doc, id).forEach((el) => Object.entries(vals).forEach(([n, v]) => el.style.setProperty(n, v)));
    // The site's live-update script says a change needs a reload; keys typed while the site has focus
    win.addEventListener("design-inspector:stale", () => window.dispatchEvent(new Event("design-inspector:stale")));
    win.addEventListener("mousemove", heldOption);
    win.addEventListener("keydown", (ev) => keyRef.current(ev));
    win.addEventListener("keyup", (ev) => keyRef.current(ev));
    // The editor's address follows the page the frame shows
    const path = win.location.pathname + win.location.search + win.location.hash;
    setSitePath(path);
    history.replaceState(null, "", `${EDITOR_PATH}?${new URLSearchParams({ path })}`);
  };

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const next: Record<string, PartKind> = {};
    for (const p of PARTS) if (p.id !== "site") next[p.id] = kindOf(p, elementOf(doc, p.id));
    setKinds((k) => (JSON.stringify(k) === JSON.stringify(next) ? k : next));
  }, [visibleKey, sitePath, mapN]);

  // Which of the layers with an address the page carries now: asked a couple of times a second (the answer is kept
  // until the page changes, so asking is cheap), and not until the page has had a moment to draw itself
  const [foundKey, setFoundKey] = useState<string | null>(null);
  const treeKey = useRef<string | null>(null);
  const pageSeen = useRef(-1);
  const pickedMissing = useRef(0); // how many looks in a row the picked thing wasn't where it was
  const followPicked = useRef<(doc: Document) => void>(() => undefined);
  useEffect(() => {
    const read = () => {
      const doc = frameRef.current?.contentDocument;
      if (!doc?.body || Date.now() - frameLoadedAt.current < SETTLE_MS) return;
      setFoundKey(addressed().filter((p) => onPage(doc, p.id)).map((p) => p.id).join(","));
      // Typing over words ends by a key or by leaving them. When the words themselves are gone (the site drew that
      // piece again, the page reloaded), nobody says so: the page is asked, or picking would stay off for good
      if (!textBoxRef.current && !(doc.activeElement as HTMLElement | null)?.isContentEditable) setEditingText((on) => (on ? false : on));
      // Which layer sits in which, and their order, as the page has them now: the list follows (parts.ts)
      const tree = readTree(doc);
      if (tree.key !== treeKey.current) {
        treeKey.current = tree.key;
        setPageTree(tree);
      }
      // The page's structure changed: the list's rows are read again, and the picked thing is followed
      const rev = pageRev(doc);
      if (rev !== pageSeen.current) {
        pageSeen.current = rev;
        setPageN((n) => n + 1);
        followPicked.current(doc);
      } else if (pickedMissing.current) followPicked.current(doc);
      // A layer's live values sit on its elements: one the site has drawn again since (a component rendering anew)
      // gets them back, so what the fields say stays what the page shows
      for (const [id, vals] of Object.entries(partEditsRef.current))
        for (const el of elementsOf(doc, id)) for (const [n, v] of Object.entries(vals)) if (el.style.getPropertyValue(n) !== v) el.style.setProperty(n, v);
    };
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, []);
  const found = useMemo(() => new Set((foundKey ?? "").split(",")), [foundKey]);
  // After a change lands, the page is looked at and the card told what it shows (observe.ts)
  useObservations(() => frameRef.current, { jobs: jobs.jobs, stale: !!jobs.stale, comparing: !!jobs.comparing, width: dev.w, loadedAt: frameLoadedAt.current, onReported: () => void jobs.refresh() });
  // None of them: this isn't the page the map describes (a built copy, another page of the site), or the tags are gone
  const noLayers = foundKey === "" && addressed().length > 0;
  // Layers left out of the list: removed (or added and undone) ones whose tag isn't in the code. One found by a
  // selector has no tag to go by, so the page decides: it's listed while the page answers its address (an Undo that
  // brings its element back brings its layer back).
  const absent = useMemo(() => new Set([...untaggedNow].filter((id) => !found.has(id))), [untaggedNow, found]);

  // Its row opens in the list: the rows it sits under (layers and things the map doesn't list alike) expanded, and
  // scrolled into view
  const reveal = useCallback((id: string | null) => {
    const part = PARTS.find((p) => p.id === id);
    if (!part) return;
    // Picking (on the page or from a list) shows its row in Layers; Assets stays open, so a picture can be picked after
    // another (the tree under it is opened all the same, for when Layers is opened)
    setTab((t) => (t === "assets" ? t : "layers"));
    const doc = frameRef.current?.contentDocument;
    const el = elementOf(doc, part.id);
    const above = el && doc?.defaultView ? rowsAbove(doc.defaultView, el) : [];
    const opening = new Set([part.group, ...ancestorsOf(part.id).map((a) => a.id), ...above]);
    setCollapsed((c) => ([...c].some((x) => opening.has(x)) ? new Set([...c].filter((x) => !opening.has(x))) : c));
    setOpenRows((o) => (above.every((x) => o.has(x)) ? o : new Set([...o, ...above])));
    requestAnimationFrame(() => treeRef.current?.querySelector(`[data-layer="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }, []);
  // Picked on the site: select it and open its layer
  const pick = useCallback(
    (id: string | null) => {
      // A click on the page ends a search under way, and the page stays where the person clicked
      cancelSearch("hand");
      navRun.current++;
      setNav(null);
      setSelected(id);
      reveal(id);
    },
    [reveal],
  );
  // A thing picked on the page or from its row. A layer of the map is picked by its id. A thing the map doesn't list
  // is listed and outlined like a layer while it is picked, addressed by its place under the nearest layer the code
  // is tagged for (objects.ts describe); the map learns of it only when it is changed or kept.
  const pickedFacts = useRef<Facts | null>(start.picked?.facts ?? null);
  const pickedEl = useRef<Element | null>(null); // its element, while the page keeps it
  const pickTarget = useCallback(
    (target: Target | null) => {
      if (!target) return pick(null);
      if (!partById(target.key)) {
        if (!target.object) return;
        pickedFacts.current = target.object.facts;
        pickedEl.current = target.el;
        pickedMissing.current = 0;
        setPickedObject(target.object.part);
      }
      pick(target.key);
    },
    [pick],
  );
  // The picked thing stays the picked thing while the page changes around it. Its element is still there: its
  // address is read again (something was added or removed beside it). Its element is gone (the page reloaded, a
  // component drew it again): the element at its address is taken when it is the same thing by its tag and words. If
  // that isn't it either, the editor says so and picks the layer it sat in.
  followPicked.current = (doc: Document) => {
    const object = pickedObject();
    const facts = pickedFacts.current;
    if (!object || !facts || facts.id !== object.id || selectedRef.current !== object.id) return void (pickedMissing.current = 0);
    let el = pickedEl.current?.isConnected ? pickedEl.current : null;
    if (el) {
      const now = describe(el, object.kind ?? "frame");
      const selector = now?.part.targets?.[0]?.selector;
      if (now && selector && (selector !== object.targets?.[0]?.selector || now.part.label !== object.label)) {
        pickedFacts.current = { ...now.facts, id: object.id };
        movePickedObject(selector, now.part.label);
      }
      return void (pickedMissing.current = 0);
    }
    // Its address may be of that thing in each of several elements of a layer (the mark in every logo): any of them
    // that is the same thing will do
    const at = elementsOf(doc, object.id).find((x) => sameAs(x, facts));
    if (at) {
      pickedEl.current = el = at;
      return void (pickedMissing.current = 0);
    }
    // Not at once: a component that draws itself again is away for a moment, and a page that has just loaded may
    // still be playing its intro (things aren't in their places yet)
    if (++pickedMissing.current < (Date.now() - frameLoadedAt.current < LOAD_PATIENCE_MS ? LOAD_PATIENCE_MS / 500 : 3)) return;
    pickedMissing.current = 0;
    const near = partById(object.parent);
    setStatus(`${object.label} isn't on the page any more${near ? `: ${near.label}, where it was, is picked` : ""}`);
    setSelected(near?.id ?? null);
    reveal(near?.id ?? null);
  };
  // The picked object becomes a layer of the map (server/layers.ts), once: pressed for, or just before the first
  // change to it goes out (api.ts beforeWrites), wherever in the panel that change is made
  const keeping = useRef<Promise<void> | null>(null);
  const keepPicked = useCallback((): Promise<void> => {
    const object = pickedObject();
    const facts = pickedFacts.current;
    if (!object || !facts || facts.id !== object.id) return Promise.resolve();
    keeping.current ??= (async () => {
      try {
        const body = JSON.stringify({ ...facts, label: object.label, kind: object.kind, listedIn: object.parent, selector: object.targets?.[0]?.selector });
        const kept = (await (await apiDirect("/__inspector/layer", { method: "POST", headers: { "Content-Type": "application/json" }, body })).json()) as { ok: boolean; error?: string; tagged?: boolean; scripted?: boolean };
        if (!kept.ok) throw new Error(kept.error ?? "The dev server said no");
        const d = (await (await apiDirect("/__inspector/map")).json()) as { ok: boolean; map?: DesignMap; at?: number };
        if (d.ok && d.map) {
          mapSeen.current = d.at ?? mapSeen.current;
          replaceMap(d.map);
        }
        bump();
        setStatus(kept.scripted ? `${object.label} is a layer now. Its words on the page aren't the words in the file: a script sets them, so typing over them won't hold` : `${object.label} is a layer now`);
      } finally {
        keeping.current = null;
      }
    })();
    return keeping.current;
  }, [bump, setStatus]);
  useEffect(() => {
    beforeWrites(async (url, body) => {
      const object = pickedObject();
      // Only what changes the site: looking (the request preview, what the page shows) keeps nothing
      if (object && CHANGES.test(url) && (body.includes(`"${object.id}"`) || url.includes(object.id))) await keepPicked();
    });
    return () => beforeWrites(null);
  }, [keepPicked]);
  // An object that was only looked at is let go when something else is picked
  useEffect(() => {
    const object = pickedObject();
    if (object && selected !== object.id) setPickedObject(null);
  }, [selected]);
  // Picked from a layer or a card: also bring it into view on the site
  // Its layer open, and the site scrolled to it
  // Where it shows (presence.ts): the map's "at" when it has one, else the element itself, else, in a pinned or
  // scrubbed story, the scroll position where it's shown (stepped through once, then remembered)
  // The layer the editor is still finding on the page: its row says "mapping…" and no "not shown" box is drawn until
  // the search has an answer (mid-search, the box read like an error)
  // One state says where a pick stands: still being brought into view (arrival null), or how that ended. The row's
  // "mapping…" chip and the footer's line are read from it, never set by hand, so neither can go stale.
  const [nav, setNav] = useState<{ id: string; label: string; arrival: Arrival | null } | null>(null);
  const navRun = useRef(0);
  const seeking = nav && !nav.arrival ? nav.id : null;
  const navNote =
    nav?.arrival?.state === "not-here"
      ? `${nav.label} isn't shown here: ${nav.arrival.why}`
      : nav?.arrival?.state === "not-found"
        ? `${nav.label} isn't shown: ${nav.arrival.why}`
        : null;
  const bringIntoView = (id: string | null, thorough = false) => {
    if (!id) return;
    reveal(id);
    const doc = frameRef.current?.contentDocument;
    const win = frameRef.current?.contentWindow;
    const part = PARTS.find((p) => p.id === id);
    if (!doc || !win || !part || id === "site") return;
    const run = ++navRun.current;
    setStatus(null);
    const there = (x: string) => onPage(doc, x);
    // A layer that has an address the page doesn't answer (a tag a component didn't pass on, a selector that matches
    // nothing): said in plain words, whatever else is shown
    const missing = whyNotFound(part, doc);
    // A layer with no element of its own (a section drawn by the layers inside it, an object inside a canvas): go to
    // the layers inside it, or say where it's drawn, never "not on this page"
    let target = id;
    if (!there(id)) {
      const inside = PARTS.filter((p) => ancestorsOf(p.id).some((a) => a.id === id) && there(p.id));
      if (inside.length) target = inside[0].id;
      else {
        const host = [...ancestorsOf(id)].reverse().find((a) => there(a.id)); // the nearest one on the page
        const hostEl = host ? elementOf(doc, host.id) : null;
        const inCanvas = !!hostEl && (hostEl.tagName === "CANVAS" || !!hostEl.querySelector("canvas") || kindOf(host as Part, hostEl) === "scene");
        setNav(null);
        setStatus(
          missing ??
            (inCanvas
              ? `${part.label} is drawn inside ${host?.label}: it has no element of its own to outline`
              : `${part.label} has no element of its own on the page: it's listed for its values${host ? ` (it sits in ${host.label})` : ""}`),
        );
        if (host) void bringTo(host.id, doc, win, host.at);
        return;
      }
    }
    const shown = PARTS.find((p) => p.id === target) ?? part;
    setNav({ id, label: part.label, arrival: null });
    void bringTo(target, doc, win, target === id ? part.at : shown.at, { thorough }).then((arrival) => {
      if (run !== navRun.current) return; // another pick since: its own state shows
      setNav(arrival.state === "cancelled" ? null : { id, label: part.label, arrival });
      if (arrival.state === "shown" && missing) setStatus(missing);
    });
  };
  // Picked from a layer or a card
  const showPart = (id: string | null) => {
    if (!id) return;
    setSelected(id);
    bringIntoView(id);
  };
  // A row of the list: its thing in one click, brought into view
  const pickRow = (row: Row) => {
    if (row.part) return showPart(row.key);
    pickTarget(row.target);
    bringIntoView(row.key);
  };
  // A row of Assets: the thing that shows that picture or video, picked as a click on it would pick it; its values
  // (and Replace…) are in Elements
  const pickAsset = (el: Element) => {
    const win = frameRef.current?.contentWindow;
    const target = win ? targetOfElement(win, el) : null;
    if (!target) return setStatus("That picture isn't in a part of the page that can be picked");
    pickTarget(target);
    bringIntoView(target.key);
    setRightTab("elements");
  };
  // Escape: up one level, to the block the picked thing is inside; at block level, nothing is picked
  const upRef = useRef<() => void>(() => undefined);
  upRef.current = () => {
    const doc = frameRef.current?.contentDocument;
    const id = selectedRef.current;
    pickTarget(id && id !== "site" && doc?.defaultView ? upFrom(doc.defaultView, elementsOf(doc, id)) : null);
  };
  // Back and Forward: to the part picked before (or after), brought into view; this never undoes a change
  const step = (dir: -1 | 1) => {
    const id = dir < 0 ? backId : forwardId;
    if (id === undefined) return;
    if (dir < 0) back();
    else forward();
    bringIntoView(id);
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // A double-click on a text in Select mode: type over it on the page. The dev server writes the new words into the
  // source when it finds them exactly once in the part's files; otherwise Claude makes the change (a card either way).
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // claude: the person asked for Claude to make it, after the inspector said it couldn't write the words itself
  const sendText = useCallback(
    async (edit: TextEdit, claude = false) => {
      setStatus("Saving the text…");
      try {
        const res = await api("/__inspector/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partId: edit.partId, changes: edit.changes, whole: edit.whole, structural: edit.structural, model: settingsRef.current.model, effort: settingsRef.current.effort, claude }),
        });
        const out = (await res.json()) as DirectOut;
        if (!out.ok) throw new Error(out.error ?? "The text couldn't be saved");
        if (!out.direct) edit.revert(); // the page shows what the files have
        if (claude && !out.direct) setStatus(`Sent to Claude: ${out.why ?? "it couldn't be done directly"}`);
        else tellDirect(out, "Text saved to the file", setStatus, () => void sendText(edit, true), bump);
      } catch (err) {
        edit.revert();
        setStatus(err instanceof Error ? err.message : "The text couldn't be saved");
      }
      bump();
    },
    [bump, setStatus],
  );
  // A double-click on a block of words (Outlines.tsx says which thing that is): it is picked and typing starts. False
  // when it has no words to type over, or they aren't in a layer.
  const pickTargetRef = useRef(pickTarget);
  pickTargetRef.current = pickTarget;
  const editText = useCallback(
    (x: number, y: number, text: Target): boolean => {
      const doc = frameRef.current?.contentDocument;
      if (!doc || !text.el) return false;
      window.getSelection()?.removeAllRanges();
      const started = beginTextEdit(doc, x, y, text.el, (edit) => {
        setEditingText(false);
        // The words changed: names are read again, and a picked thing that isn't a layer is known by its new words
        forgetTree();
        followPicked.current(doc);
        if (edit) void sendText(edit).then(() => followPicked.current(doc));
      });
      if (!started) return false;
      setEditingText(true);
      pickTargetRef.current(text);
      if (started.box) setTextBox(started.box);
      setStatus("Typing over the text: Enter keeps it, Escape puts it back");
      return true;
    },
    [sendText],
  );
  // The box over split words: Enter sends them, Escape or an unchanged text closes it
  const closeBox = (keep: boolean, value: string) => {
    const box = textBox;
    setTextBox(null);
    setEditingText(false);
    if (!box) return;
    const to = value.replace(/\s+/g, " ").trim();
    if (!keep || !to || to === box.text) return setStatus(null);
    void sendText({ partId: box.partId, changes: [], whole: { from: box.text, to }, structural: true, revert: () => undefined });
  };

  const siteRoot = () => frameRef.current?.contentDocument?.documentElement ?? null;
  const setToken = (name: string, value: string) => {
    siteRoot()?.style.setProperty(name, value);
    setEdits((x) => ({ ...x, [name]: value }));
    setStatus(null);
  };
  const resetToken = (name: string) => {
    const root = siteRoot();
    if (root) {
      if (siteSet[name] !== undefined) root.style.setProperty(name, siteSet[name]);
      else root.style.removeProperty(name);
    }
    setEdits(({ [name]: _gone, ...rest }) => rest);
  };
  // A layer's own value: set on its elements on the page (so it reaches that layer and what's inside it, nothing
  // else), and saved as a rule in the tokens file under the layer's tag, or under its selector address
  const partEls = (id: string) => elementsOf(frameRef.current?.contentDocument, id);
  // A token taken from an outer layer (relay: the inherited property that reads it, font-size) is read again here
  const setPartToken = (id: string, name: string, value: string, relay?: string) => {
    partEls(id).forEach((el) => {
      el.style.setProperty(name, value);
      if (relay) el.style.setProperty(relay, `var(${name})`);
    });
    setPartEdits((x) => ({ ...x, [id]: { ...x[id], [name]: value, ...(relay ? { [relay]: `var(${name})` } : {}) } }));
    setStatus(null);
  };
  const resetPartToken = (id: string, name: string) => {
    const relays = Object.entries(partEditsRef.current[id] ?? {}).filter(([k, v]) => !k.startsWith("--") && v === `var(${name})`).map(([k]) => k);
    partEls(id).forEach((el) => [name, ...relays].forEach((n) => el.style.removeProperty(n)));
    setPartEdits(({ [id]: own = {}, ...rest }) => {
      const left = Object.fromEntries(Object.entries(own).filter(([k]) => k !== name && !relays.includes(k)));
      return Object.keys(left).length ? { ...rest, [id]: left } : rest;
    });
  };
  // Changes count tokens; the relayed property lines go with them
  const partEditList = Object.entries(partEdits).flatMap(([id, vals]) => Object.keys(vals).filter((n) => n.startsWith("--")).map((name) => ({ id, name })));
  const setWord = (key: string, value: string | string[]) => {
    w.set(key, value);
    setStatus(null);
  };

  const content = w.words;
  const changedWords = w.has ? Object.keys(w.saved).filter((key) => JSON.stringify(content[key]) !== JSON.stringify(w.saved[key])) : [];
  const changes = Object.keys(edits).length + partEditList.length + changedWords.length;

  const resetAll = () => {
    Object.keys(edits).forEach((n) => resetToken(n));
    setEdits({});
    partEditList.forEach(({ id, name }) => resetPartToken(id, name));
    setPartEdits({});
    if (w.has) w.reset();
    setStatus("Back to the saved version");
  };
  const summary = () => {
    const lines: string[] = [];
    if (Object.keys(edits).length) {
      lines.push(`/* ${MAP.tokensFile ?? "tokens"}, :root */`);
      Object.entries(edits).forEach(([n, v]) => lines.push(`${n}: ${v};`));
    }
    for (const [id, vals] of Object.entries(partEdits)) {
      if (lines.length) lines.push("");
      lines.push(`${ruleSelector(PARTS.find((p) => p.id === id) ?? { id })} {`);
      Object.entries(vals).forEach(([n, v]) => lines.push(`  ${n}: ${v};`));
      lines.push("}");
    }
    if (changedWords.length) {
      if (lines.length) lines.push("");
      lines.push(`/* ${MAP.content?.file ?? "src/content.json"} */`);
      lines.push(JSON.stringify(Object.fromEntries(changedWords.map((key) => [key, content[key]])), null, 2));
    }
    return lines.join("\n");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary());
      setStatus("Changes copied");
    } catch {
      setStatus("Couldn't reach the clipboard");
    }
  };
  const save = async () => {
    // A value its field marks as not saveable stops the save here, before anything is sent (the server refuses it too)
    const bad = [
      ...Object.entries(edits).map(([name, v]) => ({ name, why: valueProblem(v, base.desktop[name] ?? "") })),
      ...Object.entries(partEdits).flatMap(([id, vals]) =>
        Object.entries(vals)
          .filter(([name]) => name.startsWith("--"))
          .map(([name, v]) => ({ name, why: valueProblem(v, partSaved[id]?.desktop[name] ?? base.desktop[name] ?? "") })),
      ),
    ].find((x) => x.why);
    if (bad) return setStatus(`Not saved. ${tokenLabel(bad.name, TOKENS[bad.name])}: ${bad.why}. Fix it or reset it, then save.`);
    setStatus("Saving…");
    try {
      const res = await api("/__inspector/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokens: edits,
          parts: partEdits,
          // How many elements each of those layers has on the page now: a value saved for a layer the page doesn't
          // carry would change nothing, so the server refuses it
          found: Object.fromEntries(Object.keys(partEdits).map((id) => [id, partEls(id).length])),
          content: w.has && changedWords.length ? w.words : undefined,
          // Google fonts picked for values still being saved: the page's <head> loads them from now on
          fonts: [...pickedFonts].filter((f) => [...Object.values(edits), ...Object.values(partEdits).flatMap((v) => Object.values(v))].some((v) => firstFamily(v) === f)),
        }),
      });
      const out = (await res.json()) as { ok: boolean; error?: string; missing?: string[] };
      if (!out.ok) throw new Error(out.error ?? "Save failed");
      const fromCode = Object.keys(edits).filter((n) => siteSet[n] !== undefined);
      Object.keys(edits).forEach((n) => resetToken(n));
      setEdits({});
      // The saved rule takes over from the inline values once the page has the new CSS
      partEditList.forEach(({ id, name }) => resetPartToken(id, name));
      setPartEdits({});
      setStatus(
        out.missing?.length
          ? `Saved, except ${out.missing.join(", ")}`
          : fromCode.length
            ? `Saved, but the site's code sets ${fromCode.join(", ")}: change it there (ask Claude)`
            : "Saved to files",
      );
      bump();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    }
  };

  const part = partById(selected) ?? null;
  const target = part ?? PARTS[0]; // nothing picked: the chat changes the whole site
  // The outer layers' tokens that set this layer's text (a word takes its name's size and font)
  const inherited = useMemo(
    () => (part && part.id !== "site" ? inheritedFor(part, frameRef.current?.contentDocument) : []),
    [part, visibleKey, sitePath, version, mapN],
  );
  const blocked = changes ? "Save or reset your live changes first: Claude edits the saved files." : null;
  // Which of the picked layer's values move nothing on it at this size (asked of the page a moment after the pick, so
  // the pick itself isn't held up; not while its values are being changed live)
  const [inert, setInert] = useState<{ part: string; names: Map<string, Inert> }>({ part: "", names: new Map() });
  const editingPart = !!part && !!partEdits[part.id];
  const searching = !!part && seeking === part.id; // the editor is still bringing the layer into view
  useEffect(() => {
    if (!part || part.id === "site" || !part.tokens.length || editingPart || searching) return;
    // When the browser has a free moment, never in the middle of a jump or a scroll
    type Idle = { requestIdleCallback?: (fn: () => void, o: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const w = window as unknown as Idle;
    let idleId = 0;
    const ask = () => {
      const own = partSaved[part.id]?.desktop ?? {};
      const values = Object.fromEntries(part.tokens.map((name) => [name, own[name] ?? base.desktop[name] ?? ""]));
      setInert({ part: part.id, names: inertTokens(frameRef.current?.contentDocument, part.id, values) });
    };
    const timer = window.setTimeout(() => (w.requestIdleCallback ? (idleId = w.requestIdleCallback(ask, { timeout: 2000 })) : ask()), 400);
    return () => {
      window.clearTimeout(timer);
      if (idleId) w.cancelIdleCallback?.(idleId);
    };
  }, [part, dev.w, version, foundKey, tokensCss, editingPart, searching]);

  // Play: the picked layer's animation (or the whole page's) again, with the values being edited
  // On the layer's own element, else the nearest layer around it that's on the page; never the whole page for one
  // layer. A layer whose effect settings changed since the page loaded needs the page's script to run again: reload.
  const play = (id: string | null) =>
    void (async () => {
      const doc = frameRef.current?.contentDocument;
      const win = frameRef.current?.contentWindow;
      if (!doc || !win) return;
      const chain = id && id !== "site" ? [id, ...ancestorsOf(id).map((a) => a.id)] : [];
      const el = chain.map((x) => elementOf(doc, x)).find(Boolean) ?? null;
      const part = PARTS.find((p) => p.id === id);
      const settingsChanged = !!part?.params?.length && jobs.jobs.some((j) => j.partId === id && j.state === "done" && (j.finished ?? 0) > frameLoadedAt.current);
      const how = el && !settingsChanged ? await replay(doc, el, chain) : "reload";
      if (how === "reload") {
        // Motion run by the page's script: its intro plays again, live edits kept, and the page comes back here
        reloadInPlace();
      }
      setStatus(
        how === "reload" ? "Playing: the site reloads to run its motion again, then comes back here" : how === "animations" ? "Playing the animation" : how === "hover" ? "Showing its hover" : "Playing the reveal again",
      );
    })();
  // Motion values (durations, delays, easings) go in the Animation section, below the other settings
  const isAnim = (name: string) => {
    const meta = TOKENS[name];
    // By what the value is (a time, an easing), not by its description: a 50px size described under "Motion" is a size
    const v = (base.desktop[name] ?? "").trim();
    return meta?.kind === "ms" || isEasing(v) || /^-?[\d.]+m?s$/.test(v);
  };

  // Every :root token of the tokens file, also the ones the map doesn't describe (the page's own base values)
  const undescribed = Object.keys(base.desktop).filter((n) => !(n in TOKENS));
  // A token that is exactly another token (var(--ink)) is edited as that one, under its own label: changing the alias
  // itself would only point it somewhere else
  const token = (shown: string) => {
    const alias = (base.desktop[shown] ?? "").trim().match(ALIAS)?.[1];
    const name = alias && alias !== shown && alias in base.desktop ? alias : shown;
    const meta = name === shown ? TOKENS[name] : { kind: TOKENS[name]?.kind ?? TOKENS[shown]?.kind ?? "text", role: `${tokenLabel(shown, TOKENS[shown])} uses ${tokenLabel(name, TOKENS[name])} (${name}): changing it here changes it everywhere it's used`, label: tokenLabel(shown, TOKENS[shown]) };
    return tokenControl(shown, name, meta);
  };
  const tokenControl = (key: string, name: string, meta: (typeof TOKENS)[string] | undefined) => (
    <TokenControl
      key={key}
      name={name}
      meta={meta}
      saved={base.desktop[name] ?? ""}
      phone={base.mobile[name]}
      site={siteSet[name]}
      value={edits[name] ?? siteSet[name] ?? base.desktop[name] ?? ""}
      changed={name in edits}
      onChange={(v) => setToken(name, v)}
      onReset={() => resetToken(name)}
      onFont={pickFont}
      onPlay={isAnim(name) ? () => play(selected) : undefined}
    />
  );
  // The same token as the picked layer's own value: what it uses now (its saved value, else the site-wide one)
  const partToken = (p: Part, relay?: string) => (name: string) => {
    const own = partSaved[p.id];
    // An outer layer's token: what that layer uses (its own saved value, else the site-wide one)
    const outer = relay ? ancestorsOf(p.id).reverse().find((a) => partSaved[a.id]?.desktop[name] !== undefined) : undefined;
    const siteWide = (outer && partSaved[outer.id]?.desktop[name]) || (edits[name] ?? siteSet[name] ?? base.desktop[name] ?? "");
    const saved = own?.desktop[name] ?? siteWide;
    return (
      <TokenControl
        key={`${p.id}:${name}`}
        name={name}
        meta={TOKENS[name]}
        saved={saved}
        phone={own?.mobile[name] ?? base.mobile[name]}
        value={partEdits[p.id]?.[name] ?? saved}
        changed={name in (partEdits[p.id] ?? {})}
        onChange={(v) => setPartToken(p.id, name, v, relay)}
        onReset={() => resetPartToken(p.id, name)}
        inert={!relay && inert.part === p.id && !(name in (partEdits[p.id] ?? {})) ? inert.names.get(name) : undefined}
        scope={p.label}
        onFont={pickFont}
        onPlay={isAnim(name) ? () => play(p.id) : undefined}
      />
    );
  };

  const chipFor = (p: Part, onScreen: boolean) =>
    seeking === p.id ? (
      <span className={styles.chip} data-state="working" data-seeking="" title="Finding where this layer shows on the page">
        mapping…
      </span>
    ) : workingIds.has(p.id) || (p.id === "site" && siteBusy) ? (
      <span className={styles.chip} data-state="working">changing</span>
    ) : queuedIds.has(p.id) ? (
      <span className={styles.chip} data-state="queued">queued</span>
    ) : changedIds.has(p.id) ? (
      <span className={styles.chip} data-state="changed">changed</span>
    ) : jobs.settingFlags[p.id] ? (
      <span className={styles.chip} data-state="queued" title="A setting of this layer moved or lost its place in the code: open the layer to check it">
        check
      </span>
    ) : noLayers ? null : foundKey !== null && (p.targets?.length ?? 0) > 0 && !found.has(p.id) ? (
      <span className={e.off} title="Nothing on this page carries this layer now: it may be on another page, or appear only in some state. Pick it to see why.">
        not on page
      </span>
    ) : !onScreen && p.group !== "Site" && p.outline !== false ? (
      <span className={e.off} title="Not visible at this size or scroll position">hidden</span>
    ) : null;

  const toggle = (key: string) => setCollapsed((c) => (c.has(key) ? new Set([...c].filter((x) => x !== key)) : new Set([...c, key])));

  // One row of the list, and the rows under it when it's open: a layer of the map, or a thing the map doesn't list
  // (tree.ts). The chevron opens and closes it; the row itself picks its thing; the pointer over it outlines the
  // thing on the page. Rows under a row are read from the page only when it is open.
  void pageN; // the rows are read again when the page's structure changed
  const pageDoc = frameRef.current?.contentDocument ?? null;
  const isOpen = (r: Row) => r.kids && (r.holdsLayers ? !collapsed.has(r.key) : openRows.has(r.key));
  const toggleRow = (r: Row) => (r.holdsLayers ? toggle(r.key) : setOpenRows((o) => (o.has(r.key) ? new Set([...o].filter((x) => x !== r.key)) : new Set([...o, r.key]))));
  const layerRow = (r: Row, depth: number): ReactNode => {
    const p = r.part;
    if (p && absent.has(p.id)) return null;
    const open = isOpen(r);
    const kids = open ? rowsUnder(pageDoc, p ? p.id : null, p ? null : (r.target?.el ?? null)) : [];
    const label = p ? p.label : (r.target?.label ?? "");
    return (
      <li key={r.key}>
        <div
          className={e.layerRow}
          style={{ "--depth": depth } as CSSProperties}
          data-active={r.key === selected}
          data-hover={r.key === hover?.key && r.key !== selected}
          data-changed={!!p && changedIds.has(p.id)}
          onPointerEnter={() => setHover(p ? layerTarget(pageDoc, p) : r.target)}
          onPointerLeave={() => setHover(null)}
        >
          {r.kids ? (
            <button type="button" className={e.twist} aria-expanded={open} aria-label={open ? `Close ${label}` : `Open ${label}`} onClick={() => toggleRow(r)}>
              <svg className={e.chevron} viewBox="0 0 16 16" aria-hidden="true">
                <path d="m6 4 4 4-4 4" />
              </svg>
            </button>
          ) : (
            <span className={e.twist} />
          )}
          <button type="button" className={e.layerPick} data-layer={r.key} data-listed={p && !isPickedObject(p.id) ? "true" : "false"} onClick={() => pickRow(r)}>
            <LayerIcon kind={p ? (p.id === "site" ? "site" : (kinds[p.id] ?? kindOf(p, null))) : (r.target?.kind ?? "frame")} />
            <span className={e.layerName}>{label}</span>
            {p && chipFor(p, visible.has(p.id) || childrenOf(p.id).some((k) => visible.has(k.id)))}
          </button>
        </div>
        {open && <ul>{kids.map((k) => layerRow(k, depth + 1))}</ul>}
      </li>
    );
  };

  // Focus has no Elements: whatever tab was open there, the changes show
  const rightShown: RightTab = mode === "focus" && rightTab === "elements" ? "changes" : rightTab;
  const waiting = jobs.threads.filter((t) => !t.resolved).length;
  const resolvedCount = jobs.threads.length - waiting;
  // Pages shows only on a site with several pages; one left open on a site with one shows Layers
  const leftTab: Tab = tab === "pages" && pages.length < 2 ? "layers" : tab;
  const currentPage = pagePath(new URL(sitePath, location.origin));
  // A page of the site, opened in the frame as a link on it would open it (the editor's address follows, onFrameLoad)
  const openPage = (path: string) => frameRef.current?.contentWindow?.location.assign(path);

  return (
    <div className={`${styles.root} ${e.editor}`} data-preview={full} data-mode={mode}>
      {/* Top: the logo (About), the templates, the site's name; the theme */}
      <header className={e.topbar} hidden={full}>
        <button type="button" className={e.brand} onClick={() => setAbout(true)} title="About uberdesigner" aria-label="About uberdesigner">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={MARK} />
          </svg>
          <span>uberdesigner</span>
        </button>
        <button type="button" className={e.library} onClick={() => setExploring(true)} title="Explore templates" aria-label="Template library">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14l1 13H4L5 7Z" />
            <path d="M8 8V6a4 4 0 0 1 8 0v2" />
          </svg>
        </button>
        <span className={e.slash} aria-hidden="true">
          /
        </span>
        <strong className={e.siteName} title={MAP.name}>
          {MAP.name}
        </strong>
        <span className={e.grow} />
        <div className={e.themes} role="radiogroup" aria-label="Theme">
          {(["light", "dark"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} aria-label={t === "light" ? "Light" : "Dark"} title={t === "light" ? "Light" : "Dark"} onClick={() => setTheme(t)}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {t === "light" ? (
                  <>
                    <circle cx="8" cy="8" r="3" />
                    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
                  </>
                ) : (
                  <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
                )}
              </svg>
            </button>
          ))}
        </div>
      </header>
        {full && (
          <div className={e.previewBar}>
            <div className={e.previewStart}>
              <button type="button" className={`${styles.ghost} ${e.previewBack}`} onClick={togglePreview} title="Back to the editor (Esc)">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3 5 8l5 5" />
                </svg>
                Back to editor
              </button>
              <button type="button" className={`${styles.ghost} ${e.replay}`} onClick={reloadSite} title="Reload the site and play its intro again" aria-label="Reload the site">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 5v6h-6M20 11a8 8 0 1 0-2 7" />
                </svg>
              </button>
            </div>
            <div className={e.toolbarMid}>
              <select
                className={e.previewSize}
                value={previewSize}
                onChange={(ev) => {
                  setPreviewSize(ev.target.value as "window" | Device);
                  ev.target.blur(); // so Escape reaches the editor's own key handler
                }}
                aria-label="Preview size"
              >
                <option value="window">Window</option>
                {DEVICE_IDS.map((d) => (
                  <option key={d} value={d}>
                    {DEVICES[d].label} · {DEVICES[d].w} × {DEVICES[d].h}
                  </option>
                ))}
              </select>
              <span className={e.zoom} title="The size the site is shown at">
                {dev.w} × {dev.h}
                {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ""}
              </span>
            </div>
            <span />
          </div>
        )}
        <div className={e.toolbar} hidden={full}>
          <div className={e.modes} role="radiogroup" aria-label="Mode">
            {(["focus", "design"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                title={m === "focus" ? "Focus: the site, your requests and the changes" : "Design: the layers, and the picked layer's values to change by hand"}
              >
                {m === "focus" ? "Focus" : "Design"}
              </button>
            ))}
          </div>
          <div className={e.toolbarMid}>
          <div className={e.devices} role="radiogroup" aria-label="Viewport size">
            {DEVICE_IDS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={device === d} onClick={() => setDevice(d)} title={`${DEVICES[d].label} · ${DEVICES[d].w} × ${DEVICES[d].h}`}>
                <DeviceIcon device={d} />
                <span>{DEVICES[d].label}</span>
                <small>{DEVICES[d].w}</small>
              </button>
            ))}
          </div>
          <span className={e.zoom} title="Shown at this size to fit; the site itself runs at full width">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className={e.preview}
            aria-pressed={passThrough}
            onClick={togglePreview}
            title={passThrough ? "Back to picking parts of the site" : "Use the site as a visitor would: clicks go to the site, picking pauses (or hold Option)"}
          >
            {passThrough ? "Stop preview" : "Preview"}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              {passThrough ? (
                <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
              ) : (
                <path d="M2.25 2.10225C2.25013 1.97066 2.28489 1.84143 2.35077 1.72752C2.41665 1.61361 2.51134 1.51904 2.62533 1.45331C2.73932 1.38757 2.8686 1.35299 3.00019 1.35302C3.13178 1.35305 3.26104 1.38771 3.375 1.4535L10.125 5.34975C10.2392 5.41553 10.334 5.51023 10.4 5.62432C10.4659 5.7384 10.5006 5.86785 10.5006 5.99962C10.5006 6.1314 10.4659 6.26085 10.4 6.37493C10.334 6.48902 10.2392 6.58372 10.125 6.6495L3.375 10.5465C3.26099 10.6123 3.13166 10.647 3 10.647C2.86835 10.647 2.73902 10.6123 2.62501 10.5465C2.51099 10.4807 2.41632 10.386 2.35049 10.272C2.28466 10.158 2.25 10.0287 2.25 9.897V2.10225Z" />
              )}
            </svg>
          </button>
          </div>
          <div className={e.toolbarEnd}>
            <button type="button" className={`${styles.ghost} ${e.replay}`} onClick={reloadSite} title="Replay: reload the site and play its intro again" aria-label="Replay the site">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 5v6h-6M20 11a8 8 0 1 0-2 7" />
              </svg>
            </button>
          </div>
        </div>

      {/* Left: Pages (a site with several), Layers, Assets, History. Design only: Focus leaves the site room */}
      <aside className={e.left} aria-label="Layers">
        <div className={e.tabs} role="tablist">
          {pages.length > 1 && (
            <button type="button" role="tab" aria-selected={leftTab === "pages"} onClick={() => setTab("pages")}>
              Pages
            </button>
          )}
          <button type="button" role="tab" aria-selected={leftTab === "layers"} onClick={() => setTab("layers")}>
            Layers
          </button>
          <button type="button" role="tab" aria-selected={leftTab === "assets"} onClick={() => setTab("assets")}>
            Assets
          </button>
          <button type="button" role="tab" aria-selected={leftTab === "history"} onClick={() => setTab("history")}>
            History
          </button>
        </div>
        <div className={e.leftScroll} ref={treeRef}>
          {leftTab === "pages" ? (
            <ul className={styles.pages}>
              {pages.map((pg) => (
                <li key={pg.path}>
                  <button type="button" className={styles.pageRow} data-current={pg.path === currentPage} title={pg.path} onClick={() => openPage(pg.path)}>
                    <strong>{pg.label}</strong>
                    <small>{pg.path}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : leftTab === "assets" ? (
            <Assets
              doc={pageDoc}
              version={version}
              loads={loads}
              selectedEls={selected ? (isPickedObject(selected) && pickedEl.current ? [pickedEl.current] : elementsOf(pageDoc, selected)) : []}
              onPick={pickAsset}
            />
          ) : leftTab === "history" ? (
            <History
              version={version}
              onRestored={() => {
                bump();
                void jobs.refresh(); // the cards say what the version gone back to holds, at once
              }}
            />
          ) : (
            <>
              <MapBehind check={mapCheck} />
              {noLayers && (
                <div className={styles.behind} role="status">
                  <p>
                    <strong>This page carries none of the map's layers.</strong> It may not be the page the map describes
                    {taggedFiles().length > 0 && ` (its layers are tagged in ${taggedFiles().slice(0, 3).join(", ")}${taggedFiles().length > 3 ? "…" : ""})`}, or the
                    tags have left the code. Nothing can be picked here until a page with its layers is open.
                  </p>
                </div>
              )}
              {mapUnread && (
                <button type="button" className={e.layersChanged} onClick={() => (changes ? setStatus("Save or reset your live changes first, then reload the layers") : location.reload())}>
                  The layers changed and couldn't be read · <strong>Reload layers</strong>
                </button>
              )}
              <ul className={e.tree}>
                {isNested() ? (
                  <>
                    {layerRow(rowOf(pageDoc, PARTS[0]), 0)}
                    {rowsUnder(pageDoc, null).map((r) => layerRow(r, 0))}
                  </>
                ) : (
                  GROUPS.map((g) => {
                    const parts = inGroup(g);
                    if (!parts.length) return null;
                    const open = !collapsed.has(g);
                    return (
                      <li key={g}>
                        <button type="button" className={e.groupRow} aria-expanded={open} onClick={() => toggle(g)}>
                          <svg className={e.chevron} viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m6 4 4 4-4 4" />
                          </svg>
                          <LayerIcon kind="group" />
                          <span>{g}</span>
                        </button>
                        {open && <ul>{parts.map((p) => layerRow(rowOf(pageDoc, p), 1))}</ul>}
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          )}
        </div>
        {leftTab === "layers" && (
          <button type="button" className={e.addObject} onClick={addObject} title="Describe what to add in the chat below: Claude builds it and it joins the layers">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add new object
          </button>
        )}
      </aside>

      {/* Middle: the site at a viewport size, the cards and the chat bar */}
      <main className={e.canvas}>
        <div className={e.stage} ref={stageRef}>
          {jobs.stale && <ReloadBar stale={jobs.stale} onReload={reloadInPlace} className={`${styles.reload} ${e.reload}`} />}
          <div className={e.frameLabel} hidden={full} style={{ left: frameLeft, top: frameTop - LABEL + 4 }}>
            {dev.label} <span>{dev.w} × {dev.h}</span>
          </div>
          <div
            className={e.frame}
            style={{ left: frameLeft, top: frameTop, width: dev.w, height: dev.h, transform: `scale(${scale})`, ["--inv" as string]: String(1 / scale) }}
          >
            <iframe ref={frameRef} src={START_PATH} title={`${MAP.name}, at ${dev.w} × ${dev.h}`} onLoad={onFrameLoad} />
            <Outlines
              frame={frameRef}
              scale={scale}
              passThrough={passThrough}
              selected={full ? null : selected}
              seeking={seeking}
              hover={full ? null : hover}
              marks={full ? NO_MARKS : marks}
              pins={full ? NO_PINS : pins}
              onPin={showCard}
              onHover={setHover}
              onPick={pickTarget}
              onVisible={setVisibleKey}
              onEditText={editText}
            />
            {textBox && (
              <textarea
                className={e.textBox}
                style={{ left: textBox.rect.x - 6, top: textBox.rect.y - 6, width: textBox.rect.w + 12, minHeight: textBox.rect.h + 12, ...(textBox.font as CSSProperties) }}
                defaultValue={textBox.text}
                ref={(el) => {
                  if (!el || fittedBox.current === textBox) return;
                  fittedBox.current = textBox;
                  fitTextBox(el, textBox, 12);
                }}
                autoFocus
                spellCheck={false}
                onFocus={(ev) => ev.currentTarget.select()}
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  if (ev.key === "Enter" && !ev.shiftKey) {
                    ev.preventDefault();
                    closeBox(true, ev.currentTarget.value);
                  } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    closeBox(false, "");
                  }
                }}
                onBlur={(ev) => closeBox(true, ev.currentTarget.value)}
                aria-label="New words for this text"
              />
            )}
          </div>
          <ChatBar
            part={target}
            jobs={jobs}
            settings={settings}
            onSettings={setSettings}
            manual={manual}
            onManual={setManual}
            replyTo={replyTo}
            onReplyTo={setReplyTo}
            blocked={blocked}
            onWholeSite={() => pick("site")}
            seed={chatSeed}
            onExplore={() => setExploring(true)}
          />
        </div>
      </main>

      {/* Right: the picked layer's values, then the site's global tokens */}
      <aside className={e.right} aria-label="Properties and AI changes">
        <Totals finished={jobs.jobs.filter((j) => !active(j)).length} />
        <div className={`${e.tabs} ${e.rightTabs}`} role="tablist">
          {mode === "design" && (
            <button type="button" role="tab" aria-selected={rightShown === "elements"} onClick={() => setRightTab("elements")}>
              Elements
            </button>
          )}
          <button type="button" role="tab" aria-selected={rightShown === "changes"} onClick={() => setRightTab("changes")}>
            AI changes
            {needsYou && <i className={e.dot} title="A change is running or waiting for you" />}
          </button>
          <button type="button" role="tab" aria-selected={rightShown === "resolved"} onClick={() => setRightTab("resolved")} title="Changes you kept, and changes that are out of the page">
            Resolved{resolvedCount > 0 && <small> {resolvedCount}</small>}
          </button>
        </div>
        {rightShown !== "elements" ? (
          <>
          <div className={e.rightScroll}>
            {(rightShown === "resolved" ? resolvedCount : waiting) ? (
              <Activity
                jobs={jobs}
                side="right"
                place="side"
                only={rightShown === "resolved" ? "resolved" : "active"}
                onOpen={(id) => {
                  setRightTab("elements");
                  showPart(id);
                }}
              />
            ) : (
              <p className={e.changesEmpty}>
                {rightShown === "resolved"
                  ? "Nothing here yet. A change comes here once you keep it or undo it, and stays."
                  : resolvedCount
                    ? "Nothing is waiting for you. The changes you kept or undid are in Resolved."
                    : "No changes yet. Ask for one in the chat under the site: each change Claude makes shows here, to review, keep or undo."}
              </p>
            )}
          </div>
          {/* Focus has no Elements tab, whose footer says what just happened (a text typed over and saved, with its
              Undo) and holds unsaved live changes: with something to say, the same line shows here */}
          {mode === "focus" && (status || changes > 0) && (
            <footer className={styles.foot}>
              <span className={styles.count}>
                {status ?? `${changes} unsaved change${changes > 1 ? "s" : ""}`}
                {status && offer && (
                  <>
                    {" "}
                    <button type="button" className={styles.link} onClick={offer.run}>
                      {offer.label}
                    </button>
                  </>
                )}
              </span>
              {changes > 0 && (
                <>
                  <button type="button" className={styles.ghost} onClick={resetAll}>
                    Reset
                  </button>
                  <button type="button" className={styles.primary} onClick={save}>
                    Save
                  </button>
                </>
              )}
            </footer>
          )}
          </>
        ) : (
          <>
        <div className={e.rightScroll}>
          <section className={e.section}>
            <div className={e.pickHead}>
              <button type="button" className={e.navBtn} disabled={backId === undefined} onClick={() => step(-1)} title="Back to what you picked before (⌘[)" aria-label="Back">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3 5 8l5 5" />
                </svg>
              </button>
              <button type="button" className={e.navBtn} disabled={forwardId === undefined} onClick={() => step(1)} title="Forward (⌘])" aria-label="Forward">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m6 3 5 5-5 5" />
                </svg>
              </button>
              <h2 className={e.sectionHead}>{part ? part.label : "Nothing picked"}</h2>
            </div>
            {part && isPickedObject(part.id) && (
              <p className={styles.note}>
                Not a layer of the map yet: it becomes one when you change it.{" "}
                <button type="button" className={styles.link} onClick={() => void keepPicked().catch((err: unknown) => setStatus(err instanceof Error ? err.message : "It couldn't be kept"))}>
                  Keep as layer
                </button>
              </p>
            )}
            {part && ancestorsOf(part.id).length > 0 && (
              <nav className={e.crumbs} aria-label="Layers it sits in">
                {ancestorsOf(part.id).map((a) => (
                  <button key={a.id} type="button" className={e.crumb} onClick={() => showPart(a.id)} title={`Pick ${a.label}`}>
                    {a.label}
                  </button>
                ))}
              </nav>
            )}
            {part ? (
              <PartProps
                part={part}
                content={content}
                hasWords={w.has}
                token={part.id === "site" ? token : partToken(part)}
                noElement={
                  part.id === "site" || foundKey === null || onPage(frameRef.current?.contentDocument, part.id)
                    ? null
                    : (() => {
                        const why = whyNotFound(part, frameRef.current?.contentDocument);
                        return why
                          ? `${why}. Its own values can't be changed until it's on the page: a value saved for it now would change nothing.`
                          : `${part.label} has no element of its own on the page (it's drawn inside another layer), so a value set for it alone would change nothing. The values it uses are site-wide: change them under Whole site.`;
                      })()
                }
                inherited={inherited}
                inheritedToken={(x) => partToken(part, x.property)(x.token)}
                isAnim={isAnim}
                onPlay={() => play(part.id)}
                deleteLayer={isPickedObject(part.id) ? null : <DeleteLayer part={part} settings={settings} jobs={jobs} blocked={blocked} onStatus={setStatus} />}
                extras={
                  <LayerExtras
                    part={part}
                    doc={frameRef.current?.contentDocument ?? null}
                    seen={visibleKey}
                    version={version}
                    settings={settings}
                    jobs={jobs}
                    blocked={blocked}
                    onStatus={setStatus}
                    onDone={() => {
                      bump();
                      void jobs.refresh();
                    }}
                    onPlay={() => play(part.id)}
                  />
                }
                jobs={jobs}
                settings={settings}
                manual={manual}
                onManual={setManual}
                onReply={setReplyTo}
                onTry={() => setTrying(true)}
                blocked={blocked}
                onWord={setWord}
              />
            ) : (
              <p className={styles.empty}>Click a part of the site, or a row on the left. Double-click to go inside what you picked; double-click words to type over them; Escape goes back up. With nothing picked, the chat below changes the whole site.</p>
            )}
          </section>
          {tokenGroups().length > 0 && (!part || part.id === "site") && (
            <section className={e.section}>
              <h2 className={e.sectionHead}>
                Global tokens <small>{Object.keys(TOKENS).length + undescribed.length}</small>
              </h2>
              <p className={e.sectionNote}>Site-wide values from {MAP.tokensFile}. A change shows on every part that uses it.</p>
              {[...tokenGroups()].sort((a, b) => Number(a[1].every(isAnim)) - Number(b[1].every(isAnim))).map(([group, names], i) => (
                <details key={group} className={e.tokenGroup} open={i === 0}>
                  <summary>
                    {group} <small>{names.length}</small>
                  </summary>
                  {names.map(token)}
                </details>
              ))}
              {undescribed.length > 0 && (
                <details className={e.tokenGroup}>
                  <summary>
                    Not named in the map <small>{undescribed.length}</small>
                  </summary>
                  {undescribed.map(token)}
                </details>
              )}
            </section>
          )}
        </div>
        <footer className={styles.foot}>
          <span className={styles.count}>
            {status ?? navNote ?? (changes ? `${changes} unsaved change${changes > 1 ? "s" : ""}` : "No changes")}
            {status && offer && (
              <>
                {" "}
                <button type="button" className={styles.link} onClick={offer.run}>
                  {offer.label}
                </button>
              </>
            )}
            {!status && nav?.arrival?.state === "not-found" && nav.arrival.more && (
              <>
                {" "}
                <button type="button" className={styles.link} onClick={() => bringIntoView(nav.id, true)}>
                  Look for it
                </button>
              </>
            )}
          </span>
          <button type="button" className={styles.ghost} onClick={resetAll} disabled={!changes}>
            Reset
          </button>
          <button type="button" className={styles.ghost} onClick={copy} disabled={!changes}>
            Copy
          </button>
          <button type="button" className={styles.primary} onClick={save} disabled={!changes}>
            Save
          </button>
        </footer>
          </>
        )}
      </aside>

      {exploring && <ExploreConfirm onClose={() => setExploring(false)} />}
      {about && <About onClose={() => setAbout(false)} />}
      <NarrowCover />
    </div>
  );
}

type PartPropsProps = {
  part: Part;
  inherited: Inherited[];
  inheritedToken: (x: Inherited) => ReactNode;
  extras: ReactNode;
  isAnim: (token: string) => boolean;
  onPlay: () => void;
  deleteLayer: ReactNode;
  content: Words;
  hasWords: boolean;
  token: (name: string) => ReactNode;
  noElement: string | null; // why the layer has no element on the page now: its own values can't be shown or saved
  jobs: Jobs;
  settings: Settings;
  manual: string[] | null;
  onManual: (m: string[] | null) => void;
  onReply: (j: Job) => void;
  onTry: () => void;
  blocked: string | null;
  onWord: (key: string, value: string | string[]) => void;
};

// The picked layer, like Figma's design panel: its note, its latest change, its words and tokens, where it comes from
function PartProps({ part, inherited, inheritedToken, extras, isAnim, onPlay, deleteLayer, content, hasWords, token, noElement, jobs, settings, manual, onManual, onReply, onTry, blocked, onWord }: PartPropsProps) {
  const from = [...new Set(inherited.map((x) => x.from))];
  // A layer's own value is set on its elements and saved under its tag or address: with no element on the page there
  // is nothing to set it on and nothing to show, and a saved rule would change nothing. Say so, don't offer the fields.
  const motion = noElement ? [] : part.tokens.filter(isAnim);
  const look = noElement ? [] : part.tokens.filter((t) => !isAnim(t));
  return (
    <div className={styles.details}>
      {part.note && <p className={styles.note}>{part.note}</p>}
      <LatestChange part={part} jobs={jobs} settings={settings} manual={manual} onManual={onManual} onReply={onReply} onTry={onTry} blocked={blocked} />

      {noElement && part.tokens.length > 0 && <p className={styles.note}>{noElement}</p>}

      {look.length > 0 && (
        <>
          <h3>{part.id === "site" ? "Tokens" : `${part.label} only`}</h3>
          {look.map(token)}
        </>
      )}

      {/* Text values it takes from the layer it sits in, changed here for this layer alone */}
      {from.map((f) => (
        <div key={f.id}>
          <h3>
            {part.label} only <small className={e.fromNote}>· from {f.id === "site" ? "the page" : f.label}</small>
          </h3>
          {inherited.filter((x) => x.from === f).map(inheritedToken)}
        </div>
      ))}

      {part.id !== "site" && extras}

      {hasWords && part.content && part.content.length > 0 && (
        <>
          <h3>Words</h3>
          {part.content.map((key) => {
            const value = content[key];
            if (value === undefined) return null;
            if (Array.isArray(value)) {
              return (
                <div key={key} className={styles.field}>
                  <span>{wordLabel(key)}</span>
                  <div className={styles.list}>
                    {value.map((v, i) => (
                      <input key={i} value={v} onChange={(ev) => onWord(key, value.map((x, j) => (j === i ? ev.target.value : x)))} />
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <label key={key} className={styles.field}>
                <span>{wordLabel(key)}</span>
                {value.length > 40 ? (
                  <textarea rows={3} value={value} onChange={(ev) => onWord(key, ev.target.value)} />
                ) : (
                  <input value={value} onChange={(ev) => onWord(key, ev.target.value)} />
                )}
              </label>
            );
          })}
        </>
      )}

      {/* Motion last, below everything else it sets: durations, delays, easings, with Play */}
      {motion.length > 0 && (
        <>
          <h3 className={styles.withPlay}>
            Animation <PlayButton onPlay={onPlay} />
          </h3>
          {motion.map(token)}
        </>
      )}

      <details className={e.from} open={!part.tokens.length}>
        <summary>{MAP.source?.kind === "code" ? "From the code" : "From the prompt"}</summary>
        {part.prompt.map((ref, i) => (
          <blockquote key={`${i}-${ref.where}`} className={styles.quote}>
            <cite>{ref.where}</cite>
            {ref.text}
          </blockquote>
        ))}
      </details>

      <details className={e.from}>
        <summary>Files</summary>
        <ul className={styles.files}>
          {part.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </details>

      {part.id !== "site" && deleteLayer}
    </div>
  );
}

// Asking before uberdesigner's prompt library opens in a new tab: it's another site, so say so first. Its keys stay in
// it (Escape cancels; I or Escape don't reach the editor or the site behind it).
function ExploreConfirm({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useShield(box, true, onClose);
  return (
    <div className={e.confirmBack} onClick={onClose}>
      <div ref={box} className={e.confirm} role="dialog" aria-modal="true" aria-labelledby="design-inspector-explore" onClick={(ev) => ev.stopPropagation()}>
        <h2 id="design-inspector-explore">Open uberdesigner.ai?</h2>
        <p>
          The prompt library is on our website, <code>uberdesigner.ai/library</code>. It opens in a new browser tab; this editor
          and your site stay as they are.
        </p>
        <div className={e.confirmActions}>
          <button type="button" className={styles.ghost} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primary}
            autoFocus
            onClick={() => {
              window.open(PROMPTS_URL, "_blank", "noopener,noreferrer");
              onClose();
            }}
          >
            Open in a new tab
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceIcon({ device }: { device: Device }) {
  return (
    <svg className={e.deviceIcon} viewBox="0 0 16 16" aria-hidden="true">
      {device === "phone" && <rect x="5" y="2" width="6" height="12" rx="1.5" />}
      {device === "tablet" && <rect x="3.5" y="2" width="9" height="12" rx="1.5" />}
      {device === "desktop" && (
        <>
          <rect x="1.5" y="3" width="13" height="8.5" rx="1" />
          <path d="M5.5 14h5" />
        </>
      )}
      {device === "large" && (
        <>
          <rect x="1" y="2" width="14" height="10" rx="1" />
          <path d="M8 12v2M5 14h6" />
        </>
      )}
    </svg>
  );
}

