import { memo, useCallback, useEffect, useRef, useState, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import { PARTS, ancestorsOf, partById, perMap, useMapRev } from "./parts";
import { noteShown, shownPart, shownRects } from "./presence";
import { elementsOf, watchPage } from "./resolve";
import { chainAt, insideAt, pickAt, scopeOf, targetAt, type Target } from "./tree";
import styles from "./Inspector.module.css";
import e from "./Editor.module.css";

// What is drawn over the framed site, and what the pointer does there.
//
// Drawn: one outline under the pointer, on what a click would pick right now, with its name; the picked thing; a
// dashed edge on the block the picked thing is inside; pulses on layers Claude is changing or changed. Nothing else:
// no boxes around every layer at rest. Only what is drawn is measured each frame, so scrolling the site redraws this
// and never the editor around it.
//
// The pointer (tree.ts says what is under it and what a click picks):
//   - a click picks the block under the pointer (a section on its own space);
//   - a double-click goes inside the picked block and picks the part under the pointer; from then on hover and clicks
//     work at that level inside that block, and a click outside it is back at block level;
//   - a double-click on words picks that text and starts typing, at any depth;
//   - with ⌘ held (Ctrl on Windows) a click picks the smallest thing there: a shortcut, never needed.
// The wheel over the site still scrolls it.

type Rect = { x: number; y: number; w: number; h: number };
type Box = { id: string; rects: Rect[] };
type Drawn = { selected: Rect[]; hover: Rect[]; scope: Rect[]; marks: Box[] };
export type Marks = Record<string, "working" | "queued" | "changed" | "before">;
// The numbered pins: for a layer, the changes still waiting on it (running, or made and not yet kept or undone)
export type Pins = Record<string, { n: number; thread: string }[]>;
const PIN = 28; // px, the pin's size on screen whatever the frame is scaled to

const labelOf = (id: string | null | undefined) => partById(id)?.label ?? "";
const HOVER_MS = 50; // how often what is under the pointer is looked up while it moves, at most
const HOVER_SHARE = 0.06; // and never taking more than this share of the time: a look that took 6 ms isn't repeated for 100 ms
const SCOPE_MS = 250; // how often the block the picked thing is inside is worked out again
const SEEN_MS = 400; // how often every layer is asked whether it shows (the "hidden" marks, where a jump goes)
const MARK_TEXT = { before: "Before", working: "Changing", queued: "Queued", changed: "Changed" } as const;
const NONE: Drawn = { selected: [], hover: [], scope: [], marks: [] };

// Where each layer is shown in the site's viewport right now (presence.ts: on screen, not transparent, its words not
// all transparent, not covered). Layers marked outline: false (full-screen or intro-only layers, objects inside a
// canvas) and hidden layers are listed but never outlined.
const outlined = perMap(() => new Set(PARTS.filter((p) => p.outline !== false && !p.hideWhileInspecting).map((p) => p.id)));
const rectsOf = (id: string, doc: Document, win: Window): Rect[] => (outlined().has(id) ? elementsOf(doc, id).flatMap((el) => shownRects(el, doc, win).rects) : []);
function measureAll(doc: Document): Box[] {
  const win = doc.defaultView;
  if (!win) return [];
  return [...outlined()].map((id) => ({ id, rects: rectsOf(id, doc, win) }));
}

// The picked layer when nothing of it is outlined: a faint box where it would be, and why it isn't shown. A layer
// marked outline: false (a full-screen section, a canvas scene) shows the area its nested layers take.
function ghostOf(id: string, doc: Document, boxes: Box[]): { rect: Rect; why: string } | null {
  const win = doc.defaultView;
  const part = partById(id);
  if (!win || !part) return null;
  if (part.outline === false) {
    const inside = boxes.filter((b) => ancestorsOf(b.id).some((a) => a.id === id)).flatMap((b) => b.rects);
    if (!inside.length) return null;
    const x = Math.min(...inside.map((r) => r.x));
    const y = Math.min(...inside.map((r) => r.y));
    return { rect: { x, y, w: Math.max(...inside.map((r) => r.x + r.w)) - x, h: Math.max(...inside.map((r) => r.y + r.h)) - y }, why: "the layers inside it" };
  }
  const shown = shownPart(id, doc, win);
  if (!shown.why) return null;
  const el = elementsOf(doc, id).find((x) => x.getClientRects().length);
  const r = el?.getBoundingClientRect();
  return r ? { rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.max(4, Math.round(r.width)), h: Math.max(4, Math.round(r.height)) }, why: shown.why } : null;
}

// A forwarded wheel step scrolls at once: a site with scroll-behavior: smooth would otherwise start a new smooth
// scroll on every step, each one cutting the last short, and scrolling would crawl
const INSTANT = "instant" as ScrollBehavior;
const LINE = 16; // px per line, for wheels that report lines
const deltaPx = (d: number, mode: number, page: number) => (mode === 1 ? d * LINE : mode === 2 ? d * page : d);
const SETTLE_MS = 160; // no wheel for this long: the gesture is over

// Sites that snap (scroll-snap-type: full-screen sections, carousels): a real wheel gesture moves freely and settles
// on one snap point at the end. Nudged from outside, every small step would jump a whole section instead. So while a
// forwarded gesture runs, snapping is switched off on that scroller, and switched back on when it ends, which settles
// it on the nearest snap point the way the browser does.
function useSnapGestures() {
  const held = useRef(new Map<HTMLElement, string>()); // scroller -> its own inline scroll-snap-type
  const timer = useRef(0);
  const settle = useCallback(() => {
    for (const [el, inline] of held.current) {
      el.style.scrollSnapType = inline;
      const view = el.ownerDocument.defaultView;
      const root = el === el.ownerDocument.scrollingElement;
      // Snap again from where the gesture left it
      (root && view ? view : el).scrollBy({ left: 0, top: 0, behavior: "smooth" });
    }
    held.current.clear();
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(
    (el: HTMLElement) => {
      const view = el.ownerDocument.defaultView;
      const type = view?.getComputedStyle(el).scrollSnapType ?? "none";
      if (type && type !== "none" && !held.current.has(el)) {
        held.current.set(el, el.style.scrollSnapType);
        el.style.scrollSnapType = "none";
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(settle, SETTLE_MS);
    },
    [settle],
  );
}

type Props = {
  frame: RefObject<HTMLIFrameElement | null>;
  scale: number;
  passThrough: boolean;
  selected: string | null;
  seeking: string | null; // the layer still being found on the page: no "not shown" box until the search answers
  hover: Target | null; // what the pointer is over, on the page or on a row of the list
  marks: Marks;
  pins: Pins;
  onPin: (thread: string) => void; // a pin pressed: its card
  onHover: (target: Target | null) => void;
  onPick: (target: Target | null) => void;
  onVisible: (ids: string) => void; // comma-separated ids of the layers on screen, sent when that changes
  onEditText: (x: number, y: number, text: Target) => boolean; // a double-click on a block of words: pick it and type over it (site coordinates); false when it has no words to type over
};

export const Outlines = memo(function Outlines({ frame, scale, passThrough, selected, seeking, hover, marks, pins, onPin, onHover, onPick, onVisible, onEditText }: Props) {
  useMapRev(); // labels and which layers are outlined follow the map as it changes
  const [drawn, setDrawn] = useState<Drawn>(NONE);
  const all = useRef<Box[]>([]); // every layer's boxes, as last asked (SEEN_MS)
  const catcher = useRef<HTMLDivElement>(null);
  const gesture = useSnapGestures();
  // What the frame loop and the pointer read: always the latest, without starting the loop again
  const now = useRef({ selected, hover, marks, onVisible });
  now.current = { selected, hover, marks, onVisible };
  // The block the picked thing is inside (tree.ts scopeOf), kept for a moment
  const scope = useRef<{ of: string | null; at: number; els: Element[] }>({ of: null, at: 0, els: [] });
  const scopeNow = useCallback(
    (fresh = false): Element[] => {
      const doc = frame.current?.contentDocument;
      const win = doc?.defaultView;
      const id = now.current.selected;
      const t = performance.now();
      if (!doc?.body || !win || !id || id === "site") return (scope.current = { of: id, at: t, els: [] }).els;
      if (fresh || scope.current.of !== id || t - scope.current.at > SCOPE_MS) scope.current = { of: id, at: t, els: scopeOf(win, elementsOf(doc, id)) };
      return scope.current.els;
    },
    [frame],
  );

  // Follow what is drawn as it moves (scrolling, animation, a new viewport size)
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const doc = frame.current?.contentDocument;
      const win = doc?.defaultView;
      if (doc?.body && win) {
        // An element the site drew again carries its layer's mark again within a frame (resolve.ts; nothing to do
        // when the page didn't change)
        watchPage(doc);
        const { selected: id, hover: over, marks: marked } = now.current;
        const box = (el: Element) => shownRects(el as HTMLElement, doc, win, { cover: false }).rects;
        const next: Drawn = {
          selected: id ? rectsOf(id, doc, win) : [],
          hover: over && over.key !== id ? (over.layer ? rectsOf(over.layer, doc, win) : over.els.flatMap(box)) : [],
          scope: scopeNow().flatMap(box),
          marks: Object.keys(marked).map((m) => ({ id: m, rects: rectsOf(m, doc, win) })),
        };
        const key = JSON.stringify(next);
        if (key !== last) {
          last = key;
          setDrawn(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [frame, scopeNow]);

  // Which layers show now, asked a few times a second: the list's "hidden" marks, and where each layer shows is
  // remembered as the page is scrolled, so a later jump goes straight there
  useEffect(() => {
    let lastVisible = "";
    const ask = () => {
      const doc = frame.current?.contentDocument;
      if (!doc?.body) return;
      const next = measureAll(doc);
      all.current = next;
      if (doc.defaultView) noteShown(doc.defaultView, next);
      const on = next.filter((b) => b.rects.length).map((b) => b.id).join(",");
      if (on !== lastVisible) {
        lastVisible = on;
        now.current.onVisible(on);
      }
    };
    const timer = window.setInterval(ask, SEEN_MS);
    ask();
    return () => window.clearInterval(timer);
  }, [frame]);

  // The "not shown" box answers "why can't I see what I picked". Once the picked layer has been on screen, scrolling
  // away from it is the person's own doing: no box follows them around.
  const seenSincePick = useRef(false);
  useEffect(() => void (seenSincePick.current = false), [selected]);
  const inFrame = (ev: { clientX: number; clientY: number }) => {
    const r = catcher.current?.getBoundingClientRect();
    return r ? { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale } : { x: -1, y: -1 };
  };
  // What a click at a point would pick. Worked out the same way while the pointer moves, so the box shown under the
  // pointer is what the click picks.
  const looked = useRef({ at: 0, wait: HOVER_MS });
  const under = (x: number, y: number, deep: boolean): Target | null => {
    const win = frame.current?.contentWindow;
    if (!win?.document.body) return null;
    const chain = chainAt(win, x, y);
    return targetAt(win, chain, pickAt(chain, scopeNow(), deep));
  };

  // The wheel over the selection layer still scrolls the site: handed to whatever is under the pointer, so sites that
  // listen for the wheel (smooth-scroll libraries, slides) get it too; if none of them takes it, the page scrolls
  const forwardWheel = (ev: ReactWheelEvent<HTMLDivElement>) => {
    const doc = frame.current?.contentDocument;
    const win = frame.current?.contentWindow;
    if (!doc || !win) return;
    const { x, y } = inFrame(ev);
    const dx = deltaPx(ev.deltaX, ev.deltaMode, win.innerWidth);
    const dy = deltaPx(ev.deltaY, ev.deltaMode, win.innerHeight);
    const target = doc.elementFromPoint(x, y) ?? doc.body;
    const WheelCtor = (win as unknown as { WheelEvent: typeof WheelEvent }).WheelEvent;
    const forwarded = new WheelCtor("wheel", { deltaX: dx, deltaY: dy, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
    if (!target.dispatchEvent(forwarded)) return;
    // The nearest box under the pointer that can still scroll that way, else the page
    for (let el: HTMLElement | null = target as HTMLElement; el && el !== doc.documentElement && el !== doc.body; el = el.parentElement) {
      const s = win.getComputedStyle(el);
      const canY = dy !== 0 && /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
      const canX = dx !== 0 && /(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
      if (canY || canX) {
        const before = [el.scrollLeft, el.scrollTop];
        gesture(el);
        el.scrollBy({ left: dx, top: dy, behavior: INSTANT });
        if (el.scrollLeft !== before[0] || el.scrollTop !== before[1]) return;
      }
    }
    const page = (doc.scrollingElement as HTMLElement | null) ?? doc.documentElement;
    gesture(page);
    if (doc.body && win.getComputedStyle(doc.body).scrollSnapType !== "none") gesture(doc.body);
    win.scrollBy({ left: dx, top: dy, behavior: INSTANT });
  };

  const doc = frame.current?.contentDocument;
  const pickedShows = drawn.selected.length > 0;
  if (pickedShows) seenSincePick.current = true;
  const ghost = selected && selected !== seeking && doc && !pickedShows && !seenSincePick.current ? ghostOf(selected, doc, all.current) : null;
  // beside: how many pins sit on this thing's corner; its name starts after them
  const boxes = (rects: Rect[], state: string, label: string | null, beside = 0) =>
    rects.map((r, i) => (
      <div key={`${state}-${i}`} className={styles.box} data-state={state} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
        {i === 0 && label && (
          <span className={`${styles.tag} ${e.label}`} style={beside ? { marginLeft: `calc(${beside * 30 + 2}px * var(--inv))` } : undefined}>
            {label}
          </span>
        )}
      </div>
    ));
  const pinsOn = (id: string | null | undefined) => (id && !passThrough ? (pins[id]?.length ?? 0) : 0);
  return (
    <>
      {ghost && (
        <div className={e.layer} aria-hidden="true">
          <div className={styles.box} data-state="ghost" style={{ left: ghost.rect.x, top: ghost.rect.y, width: ghost.rect.w, height: ghost.rect.h }}>
            <span className={`${styles.tag} ${e.label}`}>
              {labelOf(selected)} · {partById(selected)?.outline === false ? "the area of " : "not shown: "}
              {ghost.why}
            </span>
          </div>
        </div>
      )}
      {drawn.marks.length > 0 && (
        <div className={e.layer} aria-hidden="true">
          {drawn.marks
            .filter((b) => marks[b.id] && marks[b.id] !== "changed") // a changed part isn't framed (the frame hid the change): its pin says it
            .flatMap((b) =>
              b.rects.map((r, i) => (
                <div key={`${b.id}-${i}`} className={styles.pulse} data-state={marks[b.id]} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                  {i === 0 && (
                    <span className={`${styles.mark} ${e.label}`} style={pins[b.id]?.length ? { marginLeft: `calc(${pins[b.id].length * 30 + 2}px * var(--inv))` } : undefined}>
                      {MARK_TEXT[marks[b.id]]} · {labelOf(b.id)}
                    </span>
                  )}
                </div>
              )),
            )}
        </div>
      )}
      {/* The block the picked thing is inside (dashed), the picked thing, and the one thing under the pointer */}
      <div className={e.layer} aria-hidden="true">
        {boxes(drawn.scope, "scope", null)}
        {boxes(drawn.selected, "selected", hover || (selected && marks[selected] && marks[selected] !== "changed") ? null : labelOf(selected), pinsOn(selected))}
        {boxes(drawn.hover, "hover", hover?.label ?? null, pinsOn(hover?.key))}
      </div>
      {!passThrough && (
        <div
          ref={catcher}
          className={e.catcher}
          data-hovering={hover ? "true" : "false"}
          onPointerMove={(ev) => {
            const t = performance.now();
            if (t - looked.current.at < looked.current.wait) return;
            const { x, y } = inFrame(ev);
            const target = under(x, y, ev.metaKey || ev.ctrlKey);
            // On a heavy page or a slow computer the outline follows a little later rather than the page stuttering
            looked.current = { at: t, wait: Math.max(HOVER_MS, (performance.now() - t) / HOVER_SHARE) };
            if ((target?.key ?? null) !== (now.current.hover?.key ?? null)) onHover(target);
          }}
          onPointerLeave={() => onHover(null)}
          onClick={(ev) => {
            if (ev.detail > 1) return; // the second click of a double-click: going inside, or typing over words (below)
            const { x, y } = inFrame(ev);
            onPick(under(x, y, ev.metaKey || ev.ctrlKey));
          }}
          // A double-click would also select words in the editor around the frame
          onMouseDown={(ev) => ev.detail > 1 && ev.preventDefault()}
          onDoubleClick={(ev) => {
            const { x, y } = inFrame(ev);
            const win = frame.current?.contentWindow;
            if (!win?.document.body) return;
            const chain = chainAt(win, x, y);
            // On words (the smallest thing under the pointer is a block of words): that text, at any depth, and typing
            const leaf = chain[chain.length - 1];
            const words = leaf && (leaf.kind === "text" || leaf.kind === "button") ? targetAt(win, chain, leaf) : null;
            if (words?.el === leaf?.el && words && onEditText(x, y, words)) return;
            // Else one level into the picked block, to the part under the pointer
            const id = now.current.selected;
            if (!id) return;
            const inner = targetAt(win, chain, insideAt(chain, elementsOf(win.document, id)));
            if (inner && inner.key !== id) onPick(inner);
          }}
          onWheel={forwardWheel}
        />
      )}
      {/* A numbered pin on each part a change is waiting on: the same number as its card; a click shows the card.
          Its point sits on the part's top-left corner (inside the frame when the part starts at its very top). */}
      {!passThrough && (
        <div className={e.pins}>
          {drawn.marks
            .filter((b) => pins[b.id] && b.rects[0])
            .flatMap((b) =>
              pins[b.id].map((p, i) => (
                <button
                  key={p.thread}
                  type="button"
                  className={`${styles.pin} ${e.pinAt}`}
                  data-on="page"
                  data-thread={p.thread}
                  style={{ left: b.rects[0].x, top: Math.max(b.rects[0].y, (PIN + 2) / scale), ["--i" as string]: String(i) }}
                  onClick={() => onPin(p.thread)}
                  title={`Change ${p.n}: show its card`}
                  aria-label={`Change ${p.n}`}
                >
                  {p.n}
                </button>
              )),
            )}
        </div>
      )}
    </>
  );
});
