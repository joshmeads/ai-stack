// Play: show a layer's animation again on the page, with the values being edited (live edits are on the elements).
// 1. CSS animations (and Web Animations) of the layer's own elements restart (not a nested layer's, and not ones
//    driven by scrolling).
// 2. A hover the layer reacts to (its :hover rules) is shown for a moment, as if the pointer were over it.
// 3. Transitions that a state switches on replay: the states the page itself switched on this layer or the layers
//    around it since it loaded (presence.ts records them, whatever they're called: data-ready, .in-view,
//    data-waiting), else the usual names with yes/no values. The states go off with transitions paused, so everything
//    jumps to where it starts, then come back on and the transitions run as they do on first view.
// 4. If nothing started (motion run from the page's script: GSAP timelines, a canvas), the caller reloads the site,
//    which plays its intro, and puts the page back where it was.

import { switchesFor, type Switch } from "./presence";
import { layerAround } from "./resolve";

const STATE_ATTR = /^data-(ready|inview|in-view|visible|shown|show|revealed|reveal|loaded|entered|in|animate|animated|played|seen)$/i;
const STATE_CLASS = /^(is-)?(ready|inview|in-view|visible|shown|show|revealed|loaded|entered|in|animate|animated|seen)$/i;
const BOOLEAN_LIKE = /^(|true|1|yes|on)$/i; // data-ready="card" names something: not a state to switch
const PAUSE = "data-design-inspector-replay";
const HOVER = "data-design-inspector-hover";

export type Played = "animations" | "hover" | "states" | "reload";

type AnimHost = Element & { getAnimations?: (o?: { subtree?: boolean }) => Animation[] };
// The layer's element, what is inside it, and the elements of the layers nested directly in it (not what those hold)
const own = (root: Element, el: Element) => el === root || layerAround(el.parentElement) === root;

// The layer's own animations: not a nested layer's, and not one a scroll timeline drives
function ownAnimations(doc: Document, root: Element): Animation[] {
  const win = doc.defaultView as unknown as { CSSTransition: typeof CSSTransition; DocumentTimeline: typeof DocumentTimeline };
  return ((root as AnimHost).getAnimations?.({ subtree: true }) ?? []).filter((a) => {
    const target = (a.effect as KeyframeEffect | null)?.target ?? null;
    return !(a instanceof win.CSSTransition) && (!a.timeline || a.timeline instanceof win.DocumentTimeline) && (!target || own(root, target));
  });
}

// Its :hover (and :focus-visible) rules, copied once with the pseudo-class swapped for an attribute the inspector sets
function hoverRules(doc: Document, root: Element): Element[] {
  const targets = new Set<Element>();
  const copies: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list: CSSRuleList) => {
      for (const r of Array.from(list)) {
        if ("cssRules" in r && (r as CSSGroupingRule).cssRules && !(r as CSSStyleRule).selectorText) walk((r as CSSGroupingRule).cssRules);
        const sel = (r as CSSStyleRule).selectorText;
        if (!sel || !/:hover/.test(sel)) continue;
        const plain = sel.replace(/:hover/g, "");
        let hit: Element[] = [];
        try {
          hit = [root, ...Array.from(root.querySelectorAll("*"))].filter((el) => own(root, el) && el.matches(plain));
        } catch {
          continue;
        }
        if (!hit.length) continue;
        // The element the :hover sits on gets the attribute: the compound just before ":hover"
        const before = sel.slice(0, sel.indexOf(":hover")).split(/[\s>+~]+/).pop() ?? "";
        for (const el of hit) {
          let on: Element | null = el;
          try {
            while (on && !on.matches(before || "*")) on = on.parentElement;
          } catch {
            on = el;
          }
          if (on) targets.add(on);
        }
        copies.push((r as CSSStyleRule).cssText.replace(/:hover/g, `[${HOVER}]`));
      }
    };
    walk(rules);
  }
  if (!targets.size) return [];
  let style = doc.getElementById(HOVER);
  if (!style) {
    style = doc.createElement("style");
    style.id = HOVER;
    doc.head.appendChild(style);
  }
  style.textContent = copies.join("\n");
  return [...targets];
}

export async function replay(doc: Document, root: Element, ids: string[]): Promise<Played> {
  const win = doc.defaultView ?? window;
  const frames = (n: number) => new Promise<void>((done) => (n ? win.requestAnimationFrame(() => void frames(n - 1).then(done)) : done()));

  // 1. Its own animations
  const anims = ownAnimations(doc, root);
  if (anims.length) {
    for (const a of anims) {
      a.cancel();
      a.play();
    }
    return "animations";
  }

  // 2. A hover it reacts to
  const hovered = hoverRules(doc, root);
  if (hovered.length) {
    hovered.forEach((el) => el.setAttribute(HOVER, ""));
    win.setTimeout(() => hovered.forEach((el) => el.removeAttribute(HOVER)), 1600);
    return "hover";
  }

  // 3. States: what the page switched on it (or the layers around it), else the usual names with yes/no values
  let switches: Switch[] = switchesFor(doc, ids);
  if (!switches.length) {
    const scope: Element[] = [];
    for (let el: Element | null = root; el && el !== doc.documentElement; el = el.parentElement) scope.push(el);
    scope.push(...Array.from(root.querySelectorAll("*")).filter((el) => own(root, el)).slice(0, 2000));
    for (const el of scope) {
      for (const attr of Array.from(el.attributes)) if (STATE_ATTR.test(attr.name) && BOOLEAN_LIKE.test(attr.value)) switches.push({ el, kind: "attr", name: attr.name, value: attr.value });
      for (const c of Array.from(el.classList)) if (STATE_CLASS.test(c)) switches.push({ el, kind: "class", name: c, value: null });
    }
  }
  switches = switches.filter((s) => s.el.isConnected);
  if (!switches.length) return "reload";
  const off = switches.map((s) => {
    if (s.kind === "attr") {
      s.el.removeAttribute(s.name);
      return () => s.el.setAttribute(s.name, s.value ?? "");
    }
    s.el.classList.remove(s.name);
    return () => s.el.classList.add(s.name);
  });

  // Jump to the start without animating there, then switch the states back on so the transitions run
  let style = doc.getElementById(PAUSE);
  if (!style) {
    style = doc.createElement("style");
    style.id = PAUSE;
    style.textContent = `[${PAUSE}], [${PAUSE}] * { transition: none !important; }`;
    doc.head.appendChild(style);
  }
  // Paused from the outermost element around it (the page's top-level element), so a state switched off on an outer
  // section doesn't animate its contents away
  let pauseOn: Element = root;
  while (pauseOn.parentElement && pauseOn.parentElement !== doc.body) pauseOn = pauseOn.parentElement;
  pauseOn.setAttribute(PAUSE, "");
  void (pauseOn as HTMLElement).offsetHeight; // apply the start state now
  pauseOn.removeAttribute(PAUSE);
  void (pauseOn as HTMLElement).offsetHeight;
  await frames(2);
  off.forEach((on) => on());
  // Did anything start moving? If not, the motion comes from the page's script: reload
  await frames(2);
  const moving = ((root as AnimHost).getAnimations?.({ subtree: true }) ?? []).length + (pauseOn !== root ? ((pauseOn as AnimHost).getAnimations?.({ subtree: true }) ?? []).length : 0);
  return moving ? "states" : "reload";
}
