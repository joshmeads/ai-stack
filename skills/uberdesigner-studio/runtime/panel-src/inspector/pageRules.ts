// Which CSS rules style a layer, as the page itself says. The browser has parsed every stylesheet and knows which
// rules match which element; the server can only guess that from class names in the source. So when a change is asked
// for, the panel lists the rules that match the layer's own elements, and the server finds each one in the site's
// files and sends those to Claude (server/slices.ts rulesFromPage).
//
// A rule is named by where it came from (the stylesheet), its selector as the source writes it, and which one it is
// among the rules with that selector in that stylesheet, counted in order. Never by its text: the browser can't always
// write a rule back out as it was written.
//
// What comes along:
//   - rules that match the layer's element(s) or something inside that is its own (not a nested layer's), whatever
//     screen size they are for, and with states left off (:hover, ::before), so those rules come too;
//   - rules on the element around the layer that lay it out (display, grid, flex), marked "around";
//   - from every stylesheet of the page, so a rule in a second stylesheet that wins over the first is there.
// What doesn't: rules for the whole page (*, html, body, :root), and stylesheets from other sites.

import { elementsOf, ownedBy } from "./resolve";

export type RuleRef = { source: string; selector: string; nth: number; around?: boolean };

// CSS Modules in Vite's dev server name a class ._title_1ag08_12: the site's file says .title
export const demangle = (sel: string) => sel.replace(/\._([A-Za-z][\w-]*?)_[A-Za-z0-9-]{5}(?:_\d+)?(?![\w-])/g, ".$1");

// Where a stylesheet came from: Vite's dev id (the file's path), the page a <style> sits in, or a linked file
export function sourceOf(sheet: CSSStyleSheet | null, doc: Document): string | null {
  const node = sheet?.ownerNode as Element | null;
  const devId = node?.getAttribute?.("data-vite-dev-id");
  if (devId) return devId;
  if (node?.tagName === "STYLE") return node.id?.startsWith("design-inspector") ? null : (doc.defaultView?.location.pathname ?? "/");
  const href = sheet?.href;
  if (href && doc.defaultView && new URL(href).origin === doc.defaultView.location.origin) return new URL(href).pathname;
  return null;
}

const STATE = /::?(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|target|before|after|placeholder|selection|marker|first-line|first-letter|backdrop)\b/g;
const PAGE_WIDE = /^(\*|html|body|:root|)$/i;
const pageWide = (selector: string) => selector.split(",").every((item) => PAGE_WIDE.test((item.trim().split(/[\s>+~]+/).pop() ?? "").replace(STATE, "")));
const LAYOUT = ["display", "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-auto-flow", "flex-direction", "flex-wrap", "column-gap", "row-gap", "columns"];
const MAX_RULES = 150;

export function rulesFor(doc: Document | null | undefined, id: string): RuleRef[] {
  const els = elementsOf(doc, id);
  if (!doc || !els.length) return [];
  const around = els[0].parentElement;
  const out: RuleRef[] = [];
  const seen = new Map<string, number>(); // source + selector -> how many rules with that selector so far
  const matches = (selector: string): boolean => {
    try {
      for (const el of els) {
        if (el.matches(selector)) return true;
        for (const x of el.querySelectorAll(selector)) if (ownedBy(el, x)) return true;
      }
    } catch {
      /* a selector this browser can't read */
    }
    return false;
  };
  const lays = (rule: CSSStyleRule) => {
    try {
      return !!around && around !== doc.body && around.matches(rule.selectorText.replace(STATE, "")) && LAYOUT.some((p) => rule.style.getPropertyValue(p));
    } catch {
      return false;
    }
  };
  const walk = (list: CSSRuleList, source: string) => {
    for (const r of Array.from(list)) {
      if ("selectorText" in r && "style" in r) {
        const rule = r as CSSStyleRule;
        const selector = demangle(rule.selectorText);
        const key = `${source}\n${selector}`;
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        if (out.length >= MAX_RULES || pageWide(rule.selectorText)) continue;
        const plain = rule.selectorText.replace(STATE, "");
        if (plain && matches(plain)) out.push({ source, selector, nth });
        else if (lays(rule)) out.push({ source, selector, nth, around: true });
      }
      const inner = (r as CSSGroupingRule).cssRules;
      if (inner?.length) walk(inner, source);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    const source = sourceOf(sheet, doc);
    if (!source) continue;
    try {
      walk(sheet.cssRules, source);
    } catch {
      /* another origin's stylesheet */
    }
  }
  return out;
}
