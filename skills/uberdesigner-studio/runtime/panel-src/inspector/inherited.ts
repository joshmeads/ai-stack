import { PARTS, TOKENS, partById, type Part } from "./parts";
import { elementOf, layerAround, layerIdOf } from "./resolve";

// A layer's text often takes its size and font from the layer it sits in: a word of a name is set at the name's size, in
// its font. So a nested layer offers the outer layer's tokens that set an inherited property (font-size, font-family,
// colour…) in the outer layer's own CSS rules. Changing one for the nested layer sets the token on it and reads it
// again there (font-size: var(--fs-name)), since the browser hands down the outer layer's finished size, not the token.
// The dev server accepts the same properties (server/css-write.ts INHERITED).

export const INHERITED = ["font-size", "font-family", "font-weight", "font-style", "font-stretch", "letter-spacing", "line-height", "color", "text-transform", "word-spacing"];

export type Inherited = { token: string; property: string; from: Part };

// The site's style rules, nested ones included (media queries, layers); stylesheets from other origins (Google Fonts)
// can't be read and are skipped
export function rulesOf(doc: Document): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList) => {
    for (const r of Array.from(list)) {
      if (r instanceof (doc.defaultView as unknown as { CSSStyleRule: typeof CSSStyleRule }).CSSStyleRule) out.push(r);
      else if ("cssRules" in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      /* another origin's stylesheet */
    }
  }
  return out;
}

// A rule that says "inherit" (p { font: inherit }) passes the value on: it doesn't set it here
const sets = (rule: CSSStyleRule, property: string) => {
  const v = rule.style.getPropertyValue(property).trim();
  return !!v && !/^(inherit|unset|revert|revert-layer)$/.test(v);
};

// Which of the inherited properties each rule sets, worked out once per question: of a page's thousands of rules a
// few dozen set a font or a colour, and only those are ever matched against an element. (Asking every rule about
// every property for every piece of text took two seconds on a section with a lot of text.)
type Setting = { rule: CSSStyleRule; properties: string[] };
function settingRules(rules: CSSStyleRule[]): Setting[] {
  const out: Setting[] = [];
  for (const rule of rules) {
    const properties = INHERITED.filter((p) => sets(rule, p));
    if (properties.length) out.push({ rule, properties });
  }
  return out;
}

// Text that is this layer's own: in it, and not inside a layer nested in it (a section's headline is the headline's)
function hasOwnText(el: Element): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim() && layerAround(n.parentElement) === el) return true;
  return false;
}

// The elements holding this layer's own text (not text inside a nested layer)
function ownTextElements(el: Element): Element[] {
  const out = new Set<Element>();
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim() && n.parentElement && layerAround(n.parentElement) === el) out.add(n.parentElement);
  return [...out];
}

const matches = (el: Element, selector: string) => {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
};

// For a layer: the tokens that set its text from the elements around it, nearest first, minus its own tokens. An
// outer layer's ("DJ" from its name), or the page's own (a paragraph's size and colour set on <body>), shown as from
// the nearest layer around the element that sets it, or from the whole site.
export function inheritedFor(part: Part, doc: Document | null | undefined): Inherited[] {
  const el = elementOf(doc, part.id);
  if (!doc || !el || !hasOwnText(el)) return []; // a section, an image or a scene has no text values of its own
  const own = new Set(part.tokens);
  const setting = settingRules(rulesOf(doc));
  // The inherited properties an element's own rules set, asked once per element
  const asked = new Map<Element, Set<string>>();
  const setOn = (at: Element): Set<string> => {
    let found = asked.get(at);
    if (!found) {
      found = new Set();
      for (const { rule, properties } of setting) if (properties.some((p) => !found!.has(p)) && matches(at, rule.selectorText)) for (const p of properties) found.add(p);
      asked.set(at, found);
    }
    return found;
  };
  const out: Inherited[] = [];
  const seen = new Set<string>();
  // Properties the layer sets itself (in a rule of its own element) aren't inherited
  const setHere = new Set<string>(setOn(el));
  // Nor are those that every piece of its own text sets for itself (white words in a span of their own), and a colour
  // never reaches text an SVG draws (its fill does)
  const texts = ownTextElements(el);
  if (texts.length) {
    // Still possible: set by every text looked at so far. Most are ruled out by the first plain text.
    let every = INHERITED.filter((p) => !setHere.has(p));
    for (const t of texts) {
      if (!every.length) break;
      const here = new Set<string>();
      for (let at: Element | null = t; at && at !== el; at = at.parentElement) for (const p of setOn(at)) here.add(p);
      every = every.filter((p) => here.has(p));
    }
    for (const property of every) setHere.add(property);
    if (texts.every((t) => t.closest("svg"))) setHere.add("color");
  }
  for (let at = el.parentElement; at; at = at.parentElement) {
    const from = partById(layerIdOf(layerAround(at))) || PARTS[0];
    const here = setting.filter(({ rule }) => matches(at, rule.selectorText));
    for (const { rule, properties } of here) {
      for (const property of properties) {
        if (setHere.has(property)) continue;
        const value = rule.style.getPropertyValue(property);
        for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          const token = m[1];
          if (own.has(token) || seen.has(token) || !(token in TOKENS)) continue;
          seen.add(token);
          out.push({ token, property, from });
        }
      }
    }
    // A nearer element that sets the property ends the search for it further out
    for (const { properties } of here) for (const property of properties) setHere.add(property);
  }
  return out;
}
