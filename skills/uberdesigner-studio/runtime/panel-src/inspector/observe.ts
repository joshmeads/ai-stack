// Looking at the page before saying anything about it. The server can't see the page, and Claude can't either, so the
// panel does, and it costs no tokens: the page is already here.
//
// 1. After a change to a part has landed: does the part look any different? The part's elements are read before the
//    change is asked for and again once it's on the page (their text, how many elements they hold, and a fixed list of
//    computed properties: box, type, colour, spacing, transform, timing). If nothing differs at the size on screen,
//    the change's card says so next to Claude's own words (a rule a later stylesheet overrides, a change that only
//    shows on phones). Layers the change added are looked for on the page too.
// 2. When a layer is picked: does each of its values still drive it? The value is set to a marker on the layer's
//    elements, the same properties are read, and it's put back, all in one go so nothing is painted. A value that moves
//    nothing here is said so on its field (a later rule wins, or another size's value is the one in use).
//
// What can't be seen this way is said, not guessed: hover states, motion over time and anything drawn inside a canvas.

import { useEffect, useRef } from "react";
import { api } from "./api";
import { active, type Job } from "./jobs";
import { kindOf, partById } from "./parts";
import { elementsOf, onPage, ownedBy } from "./resolve";
import { colorShaped } from "../../server/values";

const PROPS = [
  "display", "visibility", "opacity", "position", "top", "left", "z-index", "width", "height",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "row-gap", "column-gap", "justify-content", "align-items", "flex-direction", "grid-template-columns",
  "color", "background-color", "background-image", "border-top-color", "border-top-width", "border-top-style", "border-top-left-radius",
  "box-shadow", "outline-color", "fill", "stroke", "filter", "backdrop-filter", "transform",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-transform", "text-align", "text-decoration-line",
  "transition-duration", "transition-delay", "transition-timing-function", "animation-name", "animation-duration", "animation-delay",
];
const MAX_ELEMENTS = 40; // a layer's own elements read per look: its element(s) first, then what's inside, in page order

// A layer's elements and what is inside them that is its own (not a nested layer's)
function ownElements(doc: Document, id: string): Element[] {
  const out: Element[] = [];
  for (const el of elementsOf(doc, id)) {
    out.push(el);
    for (const x of el.querySelectorAll("*")) {
      if (out.length >= MAX_ELEMENTS) return out;
      if (ownedBy(el, x)) out.push(x);
    }
  }
  return out.slice(0, MAX_ELEMENTS);
}

export type Look = { elements: number; text: string; media: string; styles: string[] };

// How a layer looks now, or null when the page doesn't carry it
export function look(doc: Document | null | undefined, id: string): Look | null {
  const win = doc?.defaultView;
  const els = elementsOf(doc, id);
  if (!doc || !win || !els.length) return null;
  const own = ownElements(doc, id);
  return {
    elements: els.reduce((n, el) => n + 1 + el.querySelectorAll("*").length, 0),
    text: els.map((el) => el.innerText ?? el.textContent ?? "").join("\n").replace(/\s+/g, " ").trim().slice(0, 4000),
    media: own.map((x) => x.getAttribute("src") ?? x.getAttribute("href") ?? "").join("|"),
    styles: own.map((x) => {
      const cs = win.getComputedStyle(x);
      return PROPS.map((p) => cs.getPropertyValue(p)).join(";");
    }),
  };
}
const same = (a: Look, b: Look) => a.elements === b.elements && a.text === b.text && a.media === b.media && a.styles.length === b.styles.length && a.styles.every((s, i) => s === b.styles[i]);

// --- 1. after a change

let frame: () => HTMLIFrameElement | null = () => null;
const asked = new Map<string, { look: Look | null; at: number }>(); // part id -> how it looked when a change was asked for
const before = new Map<string, Look | null | undefined>(); // job id -> how its part looked before (undefined: not seen)
const reported = new Set<string>();

// The site's page, for what is asked of it when a change is sent (change.ts, ChatBar.tsx)
export const sitePage = () => frame()?.contentDocument ?? null;

// Called just before a change is sent (change.ts): the part as it looks now
export function rememberBefore(partId: string) {
  asked.set(partId, { look: look(frame()?.contentDocument, partId), at: Date.now() });
}

const SETTLE_MS = 1500; // after a change finishes (or the page reloads), before the page is read again
const UNSEEN = "(hover, motion and anything drawn in a canvas aren't checked)";

type Watch = { jobs: Job[]; stale: boolean; comparing: boolean; width: number; loadedAt: number; onReported: () => void };

// What the page says about a finished change, or null when it can't be told yet
function verdict(j: Job, doc: Document, width: number): string | null {
  const part = partById(j.partId);
  const was = before.get(j.id);
  if (!part || was === undefined) return "";
  const notes: string[] = [];
  const missing = (j.added ?? []).filter((id) => !onPage(doc, id));
  if (missing.length) notes.push(`The new layer${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "aren't" : "isn't"} on the page now: ${missing.length > 1 ? "they" : "it"} may only show in some state, or the change put ${missing.length > 1 ? "them" : "it"} where the page doesn't draw.`);
  const now = look(doc, part.id);
  const el = elementsOf(doc, part.id)[0] ?? null;
  const canvas = !!el && (kindOf(part, el) === "scene" || el.tagName === "CANVAS" || !!el.querySelector("canvas"));
  // A new layer on the page is a visible change even when the part's own elements read the same
  const addedOnPage = (j.added ?? []).some((id) => onPage(doc, id));
  if (was && now && !canvas && !addedOnPage && same(was, now)) notes.push(`Nothing on ${part.label} looks different at ${width} px ${UNSEEN}.`);
  return notes.join(" ");
}

// Watches the changes: remembers how a part looked before each one, and once one has landed and the page has settled,
// tells the server what the page shows (kept on the change's card).
export function useObservations(getFrame: () => HTMLIFrameElement | null, watch: Watch) {
  frame = getFrame;
  const now = useRef(watch);
  now.current = watch;
  useEffect(() => {
    const tick = () => {
      const { jobs, stale, comparing, width, loadedAt, onReported } = now.current;
      const doc = frame()?.contentDocument;
      if (!doc?.body) return;
      for (const j of jobs) {
        if (j.mode !== "part" || !j.partId || j.direct) continue;
        if (!before.has(j.id)) {
          const a = asked.get(j.partId);
          // Asked from this editor a moment before the job appeared: that look. Else, while it still runs, the look now.
          if (a && j.queuedAt - a.at < 15000 && a.at - j.queuedAt < 2000) {
            before.set(j.id, a.look);
            asked.delete(j.partId);
          } else before.set(j.id, active(j) ? look(doc, j.partId) : undefined);
        }
        if (j.state !== "done" || !j.files?.length || j.undone || j.observed || reported.has(j.id)) continue;
        // Not while the page still shows the old state: a reload is pending, or Before/After shows "before"
        if (stale || comparing || Date.now() - (j.finished ?? 0) < SETTLE_MS || Date.now() - loadedAt < SETTLE_MS) continue;
        const note = verdict(j, doc, width);
        if (note === null) continue;
        reported.add(j.id);
        void api("/__inspector/observed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: j.id, width, note }) })
          .then(onReported) // the card shows it at once, not at the next slow poll
          .catch(() => reported.delete(j.id));
      }
    };
    const timer = window.setInterval(tick, 700);
    return () => window.clearInterval(timer);
  }, []);
}

// --- 2. does a value still drive this layer?

const TIME = /^-?\d*\.?\d+m?s$/;
const NUMBER = /^-?\d*\.?\d+$/;
// A value that is certainly different from the one in use, of the same kind; null when the kind can't be probed
// (a font, an easing, a keyword)
function marker(value: string, win: Window): string | null {
  const v = value.trim();
  if (!v) return null;
  if (colorShaped(v) && !/^(inherit|initial|unset|revert|revert-layer)$/i.test(v)) return /^rgb\(1, 2, 3\)$/.test(v) ? "rgb(250, 251, 252)" : "rgb(1, 2, 3)";
  if (TIME.test(v)) return "7.777s";
  if (NUMBER.test(v)) return String(+v * 1.37 + 0.123);
  const grown = `calc((${v}) * 1.31 + 3px)`;
  const css = (win as unknown as { CSS?: typeof CSS }).CSS;
  return css?.supports("width", grown) ? grown : null;
}

// The page's style rules with their text, and whether each applies at this size (its media queries match).
// hidden: the rule sets a shorthand from a var() and then one of its parts again (background: var(--x) followed by
// background-size). The browser can no longer write such a shorthand out: its text reads "background-image: ;" and
// doesn't say which value the rule uses. It may be any.
type PageRule = { rule: CSSStyleRule; text: string; applies: boolean; hidden: boolean };
function pageRules(doc: Document, win: Window): PageRule[] {
  const out: PageRule[] = [];
  const walk = (list: CSSRuleList, applies: boolean) => {
    for (const r of Array.from(list)) {
      if ("selectorText" in r && "style" in r) {
        const text = r.cssText;
        out.push({ rule: r as CSSStyleRule, text, applies, hidden: /:\s*;/.test(text) });
      }
      const inner = (r as CSSGroupingRule).cssRules;
      if (inner?.length) {
        const media = (r as CSSMediaRule).media?.mediaText;
        walk(inner, applies && (media ? win.matchMedia(media).matches : true));
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules, !sheet.media?.mediaText || win.matchMedia(sheet.media.mediaText).matches);
    } catch {
      /* another origin's stylesheet (Google Fonts): can't be read */
    }
  }
  return out;
}
// A selector without its states and pseudo-elements (:hover, ::before), to see whose state or pseudo-element it is
const STATE = /::?(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|target|before|after|placeholder|selection|marker|first-line|first-letter|backdrop)\b/g;
// The elements a rule could style in another state: the ones its last part names by one class, by id or, with neither,
// by tag (".site-nav.scrolled" is the nav's rule, once it has scrolled; ".open-status.is-open::before" the status's)
function looser(selector: string): string {
  return selector
    .split(",")
    .map((item) => {
      const last = item.trim().replace(STATE, "").split(/[\s>+~]+/).pop() ?? "";
      const named = [...last.matchAll(/[.#][A-Za-z_][\w-]*/g)].map((m) => m[0]);
      return named.length ? named.join(", ") : (last.match(/^[a-z][a-z0-9-]*/i)?.[0] ?? "");
    })
    .filter(Boolean)
    .join(", ");
}
const PER_RULE = 24; // elements read per rule: enough to see whether a value moves anything

// What the page says about a layer's values at this size. A layer's own value is set on its element(s), so it can only
// reach rules that match those elements or something inside them:
//   "overridden"  a rule there uses the value and applies now, yet changing the value moves none of that rule's
//                 properties: a later rule sets them
//   "unused"      no rule there (and no inline style) uses the value at all, so changing it here shows nothing
// A value used only in a state (:hover, a class a script adds), in a ::before, or in a rule for another size is left
// out, and so is one whose kind can't be probed: not in the answer means "don't know", never "in use".
// Kept cheap, since it runs on every pick: the browser does the matching (one scoped query per rule that names one of
// the values, asked once), and only those rules' own properties are read.
export type Inert = "overridden" | "unused";
export function inertTokens(doc: Document | null | undefined, id: string, tokens: Record<string, string>): Map<string, Inert> {
  const idle = new Map<string, Inert>();
  const win = doc?.defaultView;
  const els = elementsOf(doc, id);
  const names = Object.keys(tokens);
  if (!doc || !win || !els.length || !names.length) return idle;
  const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const anyName = new RegExp(`var\\(\\s*(?:${names.map(escaped).join("|")})\\s*[,)]`);
  const rules = pageRules(doc, win).filter((r) => r.hidden || anyName.test(r.text));
  // The layer's elements, and the ones inside, that a selector matches (the browser's own matching, scoped to the layer)
  const found = new Map<string, Element[]>();
  const hits = (selector: string): Element[] => {
    let list = found.get(selector);
    if (list) return list;
    list = [];
    if (selector) {
      try {
        for (const el of els) {
          if (el.matches(selector)) list.push(el);
          list.push(...el.querySelectorAll(selector));
        }
      } catch {
        /* a selector this browser can't read */
      }
    }
    found.set(selector, list);
    return list;
  };
  const inline = [...els, ...els.flatMap((el) => [...el.querySelectorAll("[style*='var(']")])];
  // No transition may start while a value is set and put back (the timing values themselves stay readable)
  const still = doc.createElement("style");
  still.textContent = "*, *::before, *::after { transition-property: none !important; }";
  const bare = els.map((el) => !el.hasAttribute("style")); // elements with no style attribute: left with none
  let probing = false;
  try {
    for (const [name, value] of Object.entries(tokens)) {
      const uses = new RegExp(`var\\(\\s*${escaped(name)}\\s*[,)]`);
      const read = new Map<Element, Set<string>>(); // element -> the properties of the rules that use the value on it
      let elsewhere = false; // used in a state, a pseudo-element or another size's rule
      let certain = false; // a rule that applies here names the value in so many words
      let maybe = false; // a rule that applies here uses some value the browser can't name (see PageRule.hidden)
      const note = (el: Element, style: CSSStyleDeclaration) => {
        const set = read.get(el) ?? new Set<string>();
        for (let i = 0; i < style.length; i++) set.add(style[i]);
        read.set(el, set);
      };
      for (const r of rules) {
        const named = uses.test(r.text);
        if (!named && !r.hidden) continue;
        const on = hits(r.rule.selectorText);
        if (r.applies && on.length) {
          on.slice(0, PER_RULE).forEach((el) => note(el, r.rule.style));
          if (named) certain = true;
          else maybe = true;
        } else if (named && !elsewhere && (on.length || hits(looser(r.rule.selectorText)).length)) elsewhere = true;
      }
      for (const el of inline) {
        if (!uses.test(el.getAttribute("style") ?? "")) continue;
        note(el, (el as HTMLElement).style);
        certain = true;
      }
      if (!certain && !maybe) {
        if (!elsewhere) idle.set(name, "unused");
        continue;
      }
      const mark = marker(value, win);
      if (!mark) continue;
      if (!probing) {
        doc.head.appendChild(still);
        probing = true;
      }
      const look = () => [...read].map(([el, props]) => {
        const cs = win.getComputedStyle(el);
        return [...props].map((p) => cs.getPropertyValue(p)).join(";");
      });
      const base = look();
      const kept = els.map((el) => [el.style.getPropertyValue(name), el.style.getPropertyPriority(name)] as const);
      els.forEach((el) => el.style.setProperty(name, mark, "important"));
      const moved = look().some((s, i) => s !== base[i]);
      els.forEach((el, i) => (kept[i][0] ? el.style.setProperty(name, kept[i][0], kept[i][1]) : el.style.removeProperty(name)));
      if (!moved && certain) idle.set(name, "overridden"); // with only a "maybe" rule, nothing moving proves nothing
    }
    els.forEach((el, i) => bare[i] && !el.getAttribute("style") && el.removeAttribute("style"));
    if (probing) void win.getComputedStyle(els[0]).opacity; // styles settled back before transitions are allowed again
  } finally {
    still.remove();
  }
  return idle;
}
