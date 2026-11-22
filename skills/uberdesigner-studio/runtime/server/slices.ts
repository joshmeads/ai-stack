// Automatic context: what a change to one part sends to Claude, worked out from the part itself instead of ticked
// files. Small files go whole; in big files only the pieces that belong to the part are sent as slices: its markup,
// the CSS rules for its classes (and their keyframes), the script functions that touch it, and the tokens. The
// request's words add the motion or words files when it's about motion or wording. Everything here works on the
// same "view" of each file Claude sees (embedded data already replaced by placeholders), so offsets line up.

import { TAG, anchorsOf, hasTag, selectorsOf } from "./address.ts";

export type Range = { start: number; end: number; note: string };
export type Source = { file: string; whole: boolean; ranges: Range[]; reason: string };

export type PartLike = { id: string; edit: string[]; tokens: string[]; outline?: boolean; targets?: unknown[] };
export type MapLike = { tokensFile?: string | null; content?: { file: string } | null; extraFiles?: string[] };
// A rule the page applies to the part, as the panel names it (panel-src/inspector/pageRules.ts): its selector as the
// source writes it, and which one it is among the rules with that selector in its file, in order. around: a rule on
// the element around the part that lays it out.
export type PageRule = { selector: string; nth: number; around?: boolean };
export type PageFacts = Map<string, PageRule[]>; // site file -> the rules of it the page applies to the part

const WHOLE_BELOW = 9000; // characters: a file this small goes whole
const MAX_FUNCTIONS = 4;
const MOTION = /\b(anim\w*|motion|hover|transition|scroll\w*|intro|fade\w*|speed|slow\w*|fast\w*|appear\w*|reveal\w*|parallax|bounce|spin|rotat\w*|drop\w*|sway\w*|loop\w*|timing|delay|eas\w*|move\w*|float\w*|pulse\w*|swing\w*|drip\w*)\b/i;
const WORDS = /\b(text|copy|word\w*|title|label|rename|say|says|translate|language|typo|headline text|heading text)\b/i;
const STYLE = /\b(colou?r\w*|size|font\w*|spacing|padding|margin|radius|round\w*|shadow\w*|border\w*|gradient|bigger|smaller|darker|lighter|bold\w*|thin\w*|wider|narrower|tokens?)\b/i;

// --- reading markup, CSS and scripts with offsets

const blank = (s: string) => s.replace(/[^\n]/g, " ");

// Markup with comments and the inside of <script>/<style> blanked (same length)
export function markupOnly(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, a: string, b: string, c: string) => a + blank(b) + c)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a: string, b: string, c: string) => a + blank(b) + c);
}

// Regions of a file that are CSS, and that are script, as [start, end) offsets
function regions(file: string, text: string): { css: [number, number][]; js: [number, number][] } {
  if (/\.css$/.test(file)) return { css: [[0, text.length]], js: [] };
  if (/\.(m?js|tsx?|jsx)$/.test(file)) return { css: [], js: [[0, text.length]] };
  const css: [number, number][] = [];
  const js: [number, number][] = [];
  for (const m of text.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/gi)) {
    const s = (m.index ?? 0) + m[1].length;
    css.push([s, s + m[2].length]);
  }
  for (const m of text.matchAll(/(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)<\/script>/gi)) {
    const s = (m.index ?? 0) + m[1].length;
    js.push([s, s + m[2].length]);
  }
  return { css, js };
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// The full extent of every element tagged data-dm="id" in an HTML file
export function htmlElements(text: string, id: string): Range[] {
  const masked = markupOnly(text);
  const out: Range[] = [];
  const open = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\s${TAG}=["']${id}["'][^>]*>`, "g");
  for (const m of masked.matchAll(open)) {
    const name = m[1].toLowerCase();
    const start = m.index ?? 0;
    let end = start + m[0].length;
    if (!VOID.has(name) && !m[0].endsWith("/>")) {
      const tags = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, "gi");
      tags.lastIndex = end;
      let depth = 1;
      for (let t = tags.exec(masked); t; t = tags.exec(masked)) {
        if (t[2] === "/") continue;
        depth += t[1] === "/" ? -1 : 1;
        if (depth === 0) {
          end = t.index + t[0].length;
          break;
        }
      }
    }
    out.push({ start, end, note: `the ${name} tagged ${id}` });
  }
  return out;
}

// Class names an element (and everything inside it) uses: class="a b", className={styles.a}, `${styles.b}`
function classesIn(snippet: string): string[] {
  const found = new Set<string>();
  for (const m of snippet.matchAll(/\bclass(?:Name)?\s*=\s*["']([^"']+)["']/g)) m[1].split(/\s+/).forEach((c) => c && found.add(c));
  for (const m of snippet.matchAll(/styles\.([\w-]+)/g)) found.add(m[1]);
  for (const m of snippet.matchAll(/styles\[["']([\w-]+)["']\]/g)) found.add(m[1]);
  return [...found].filter((c) => c.length > 1 && !/^(pre|js|on|off|is|active)$/.test(c));
}

type Rule = { start: number; end: number; selector: string; media: string | null; body: string };

// CSS rules (and @keyframes) inside a region, with offsets; rules inside @media/@supports are listed with their at-rule
function cssRules(text: string, from: number, to: number): { rules: Rule[]; keyframes: Map<string, Range> } {
  const rules: Rule[] = [];
  const keyframes = new Map<string, Range>();
  const src = text.slice(0, to).replace(/\/\*[\s\S]*?\*\//g, blank);
  const walk = (start: number, end: number, media: string | null) => {
    let i = start;
    while (i < end) {
      const open = src.indexOf("{", i);
      if (open < 0 || open >= end) return;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < end && depth) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const preStart = i + (src.slice(i, open).length - src.slice(i, open).trimStart().length);
      if (/^@(media|supports|container|layer)\b/i.test(prelude)) walk(open + 1, j - 1, prelude);
      else if (/^@(-webkit-)?keyframes\s+/i.test(prelude)) {
        const name = prelude.replace(/^@(-webkit-)?keyframes\s+/i, "").trim();
        keyframes.set(name, { start: preStart, end: j, note: `@keyframes ${name}` });
      } else if (prelude && !prelude.startsWith("@")) {
        rules.push({ start: preStart, end: j, selector: prelude, media, body: src.slice(open + 1, j - 1) });
      }
      i = j;
    }
  };
  walk(from, to, null);
  return { rules, keyframes };
}

// One spelling for a selector, so the browser's way of writing it (".a > .b", [x="y"], ::before) and the source's
// (".a>.b", [x=y], :before) compare equal
const sameSelector = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([>+~,])\s*/g, "$1")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\[([^\]]*)\]/g, (_m, inner: string) => `[${inner.replace(/["'\s]/g, "")}]`)
    .replace(/::/g, ":")
    .trim();

// The rules of a file that the page applies to a part, found by selector and position (never by a rule's text: the
// browser can't always write a rule back out as it was written). missed: how many the file doesn't have as named (a
// stylesheet a build step rewrote, a nested rule).
export function rulesFromPage(file: string, text: string, refs: PageRule[]): { hits: { rule: Rule; around: boolean }[]; keyframes: Map<string, Range>; missed: number } {
  const by = new Map<string, Rule[]>();
  const keyframes = new Map<string, Range>();
  for (const [a, b] of regions(file, text).css) {
    const found = cssRules(text, a, b);
    for (const r of found.rules) by.set(sameSelector(r.selector), [...(by.get(sameSelector(r.selector)) ?? []), r]);
    for (const [name, range] of found.keyframes) keyframes.set(name, range);
  }
  const hits: { rule: Rule; around: boolean }[] = [];
  let missed = 0;
  for (const ref of refs) {
    const rule = by.get(sameSelector(ref.selector))?.[ref.nth];
    if (!rule) missed++;
    else if (!hits.some((h) => h.rule === rule)) hits.push({ rule, around: !!ref.around });
  }
  return { hits, keyframes, missed };
}

// Named functions in a script region, with their full extent
function functions(text: string, from: number, to: number): { name: string; start: number; end: number; body: string }[] {
  const src = text.slice(0, to);
  const out: { name: string; start: number; end: number; body: string }[] = [];
  const re = /(?:^|[\n;])\s*((?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b[^(]*\(|\([^)]*\)\s*=>|[\w$]+\s*=>))/g;
  re.lastIndex = from;
  for (let m = re.exec(src); m && m.index < to; m = re.exec(src)) {
    const name = m[2] ?? m[3];
    const start = m.index + m[0].indexOf(m[1]);
    const brace = src.indexOf("{", start);
    if (brace < 0 || brace > to) continue;
    let depth = 1;
    let j = brace + 1;
    while (j < to && depth) {
      const ch = src[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === '"' || ch === "'" || ch === "`") {
        const q = ch;
        j++;
        while (j < to && src[j] !== q) j += src[j] === "\\" ? 2 : 1;
      }
      j++;
    }
    out.push({ name, start, end: j, body: src.slice(brace, j) });
    re.lastIndex = j;
  }
  return out;
}

const mentions = (body: string, classes: string[], id: string) =>
  classes.reduce((n, c) => n + (body.match(new RegExp(`[.'"\`\\s]${c.replace(/[-$]/g, "\\$&")}\\b`, "g"))?.length ?? 0), 0) +
  (body.match(new RegExp(`${TAG}=["']?${id}|\\b${id}\\b`, "g"))?.length ?? 0);

// How much a function belongs to the part: its body mentions the part's classes or id; its name or the comment just
// above it names the part or one of its classes; its name echoes a word of the request ("sway" → startSway)
function fnScore(fn: { name: string; start: number; body: string }, text: string, classes: string[], id: string, request: string): number {
  const lower = fn.name.toLowerCase();
  const names = [id, ...classes].map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((x) => x.length > 2);
  const asked = (request.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(ing|er|ed|es|s)$/, "")).filter((w) => w.length >= 4);
  const comment = text.slice(Math.max(0, fn.start - 240), fn.start).split("\n").slice(-3).join(" ").toLowerCase();
  return (
    mentions(fn.body, classes, id) +
    (names.some((n) => lower.includes(n)) ? 3 : 0) +
    (asked.some((w) => lower.includes(w)) ? 3 : 0) +
    (names.some((n) => comment.includes(n)) && /\/\*|\/\//.test(comment) ? 1 : 0)
  );
}

const merge = (ranges: Range[]): Range[] =>
  ranges
    .sort((a, b) => a.start - b.start)
    .reduce<Range[]>((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && r.start <= last.end) {
        last.end = Math.max(last.end, r.end);
        if (!last.note.includes(r.note)) last.note += `; ${r.note}`;
      } else acc.push({ ...r });
      return acc;
    }, []);

// --- the resolver

export function resolveContext(
  part: PartLike,
  request: string,
  map: MapLike,
  files: string[], // every editable file of the site
  view: (file: string) => string, // a file as Claude sees it (embedded data as placeholders)
  page?: PageFacts, // the rules the page applies to the part, when a page was there to ask (else: matched by class names)
): Source[] {
  const motion = MOTION.test(request);
  const words = WORDS.test(request);
  const style = STYLE.test(request) || !(motion || words);
  const sources = new Map<string, Source>();
  const add = (file: string, reason: string, ranges: Range[] | "whole") => {
    const prev = sources.get(file) ?? { file, whole: false, ranges: [], reason };
    if (ranges === "whole") prev.whole = true;
    else prev.ranges.push(...ranges);
    if (!prev.reason.includes(reason)) prev.reason = prev.reason === reason ? reason : `${prev.reason}, ${reason}`;
    sources.set(file, prev);
  };

  // 1. Where the part is: tagged elements, and the classes they use. In plain HTML also the tagged element's own tag
  // and id: pages written by hand or by Claude often style a classless element by tag in its section (".hero h1").
  const classes = new Set<string>();
  const elements = new Set<string>(); // tag names of the tagged elements (h1, section)
  const ids = new Set<string>();
  const tagged: { file: string; ranges: Range[] }[] = [];
  // A layer found by a selector has no tag of its own: its place in the code is the tagged layer its selector starts
  // from ([data-dm='features'] h2 -> features), and what the selector itself names (a class, an id, the element)
  const addresses = selectorsOf(part);
  const around = [...new Set(addresses.flatMap(anchorsOf))].filter((id) => id !== part.id);
  for (const selector of addresses) {
    const bare = selector.replace(/\[[^\]]*\]/g, " ");
    for (const m of bare.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(m[1]);
    for (const m of bare.matchAll(/#([\w-]+)/g)) ids.add(m[1]);
    for (const item of bare.split(",")) {
      const last = item.trim().split(/[\s>+~]+/).pop() ?? "";
      const tag = last.match(/^([a-z][a-z0-9-]*)/i)?.[1];
      if (tag && !/[.#]/.test(last)) elements.add(tag.toLowerCase());
    }
  }
  for (const f of files) {
    const text = view(f);
    if (!hasTag(text, part.id)) {
      const holds = around.filter((id) => hasTag(text, id));
      if (holds.length) tagged.push({ file: f, ranges: /\.html?$/.test(f) ? holds.flatMap((id) => htmlElements(text, id).map((r) => ({ ...r, note: `${r.note}, which this part sits in` }))) : [] });
      continue;
    }
    const ranges = /\.html?$/.test(f) ? htmlElements(text, part.id) : [];
    if (/\.html?$/.test(f))
      ranges.forEach((r) => {
        const snippet = text.slice(r.start, r.end);
        classesIn(snippet).forEach((c) => classes.add(c));
        const open = snippet.match(/^<([a-zA-Z][\w-]*)\b[^>]*>/);
        if (open) {
          // By tag only when the element has no class of its own (then class rules can't find it); with a class, a tag
          // match mostly brings rules for other elements of that kind
          if (!/\sclass=["'][^"']*\S/.test(open[0])) elements.add(open[1].toLowerCase());
          const id = open[0].match(/\sid=["']([\w-]+)["']/);
          if (id) ids.add(id[1]);
        }
      });
    else classesIn(text).forEach((c) => classes.add(c));
    tagged.push({ file: f, ranges });
  }

  // 2. The part's own files (its component, its CSS module, …): whole when small
  const own = [...new Set([...part.edit, ...tagged.map((t) => t.file)])];
  const usedTokens = new Set<string>(part.tokens); // the values the part's rules use, for which token blocks to send
  for (const f of own) {
    const text = view(f);
    if (text.length <= WHOLE_BELOW) {
      add(f, "the part's file", "whole");
      continue;
    }
    // A big file: the part's markup, its CSS rules and keyframes, the functions that touch it
    const t = tagged.find((x) => x.file === f);
    if (t?.ranges.length) add(f, "the part's markup", t.ranges.map((r) => ({ ...r, note: "markup: " + r.note })));
    const { css, js } = regions(f, text);
    const cls = [...classes];
    // The page said which rules of this file style the part: those, found by selector and position. If the file
    // doesn't have most of them as named (a build step rewrote it), the class names below decide as before.
    const asked = page?.get(f);
    const fromPage = asked?.length ? rulesFromPage(f, text, asked) : null;
    const trusted = !!fromPage && fromPage.hits.length > 0 && fromPage.missed <= fromPage.hits.length;
    if (fromPage && trusted) {
      fromPage.hits.forEach(({ rule: r, around }) =>
        add(f, around ? "the layout around it" : "its CSS", [{ start: r.start, end: r.end, note: `CSS ${r.selector.slice(0, 60)}${r.media ? ` inside ${r.media}` : ""}${around ? " (lays out the element around it)" : ""}` }]),
      );
      const names = new Set(fromPage.hits.flatMap(({ rule: r }) => [...r.body.matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)].map((m) => m[1])));
      names.forEach((n) => fromPage.keyframes.get(n) && add(f, "its keyframes", [fromPage.keyframes.get(n) as Range]));
      fromPage.hits.forEach(({ rule: r }) => [...r.body.matchAll(/var\(\s*(--[\w-]+)/g)].forEach((m) => usedTokens.add(m[1])));
    }
    for (const [a, b] of css) {
      const { rules, keyframes } = cssRules(text, a, b);
      if (trusted) {
        // What the page can't show now: a state of one of the part's elements that isn't on it at the moment
        const got = new Set(fromPage?.hits.map((h) => h.rule.start));
        // (.card.is-open, .nav[data-stuck]): the element the rule styles, its last part, carries one of the part's
        // classes plus a class or an attribute the part doesn't have now. A rule that only passes through the part's
        // class on the way to something else isn't one.
        const lastHas = (selector: string) =>
          selector.split(",").some((item) => {
            const last = (item.trim().split(/[\s>+~]+/).pop() ?? "").replace(/::?[\w-]+(\([^)]*\))?/g, "");
            const named = [...last.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
            return named.some((c) => cls.includes(c)) && (named.some((c) => !cls.includes(c)) || /\[/.test(last));
          });
        rules
          .filter((r) => !got.has(r.start) && lastHas(r.selector))
          .forEach((r) => add(f, "its CSS in another state", [{ start: r.start, end: r.end, note: `CSS ${r.selector.slice(0, 60)}${r.media ? ` inside ${r.media}` : ""}` }]));
        // The tokens: the block new ones go into, and any block that sets one of the values these rules use
        if (style || part.tokens.length) {
          [...text.slice(a, b).matchAll(/:root\s*\{[^}]*\}/g)].forEach((m, i) => {
            const sets = [...m[0].matchAll(/(--[\w-]+)\s*:/g)].map((d) => d[1]);
            if (i === 0 || sets.some((t) => usedTokens.has(t))) add(f, "the tokens", [{ start: a + (m.index ?? 0), end: a + (m.index ?? 0) + m[0].length, note: ":root tokens" }]);
          });
        }
        continue;
      }
      const byElement = (selector: string) =>
        selector.split(",").some((item) => [...elements].some((t) => new RegExp(`(^|[\\s>+~(])${t}(?![\\w-])`, "i").test(item.trim())) || [...ids].some((id) => new RegExp(`#${id}(?![\\w-])`).test(item)));
      const hit = rules.filter((r) => cls.some((c) => new RegExp(`\\.${c.replace(/[-$]/g, "\\$&")}(?![\\w-])`).test(r.selector)) || r.selector.includes(`${TAG}="${part.id}"`) || addresses.some((s) => r.selector.replace(/'/g, '"').replace(/\s+/g, " ").includes(s)) || byElement(r.selector));
      hit.forEach((r) => add(f, "its CSS", [{ start: r.start, end: r.end, note: `CSS ${r.selector.slice(0, 60)}${r.media ? ` inside ${r.media}` : ""}` }]));
      const used = new Set(hit.flatMap((r) => [...r.body.matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)].map((m) => m[1])));
      used.forEach((n) => keyframes.get(n) && add(f, "its keyframes", [keyframes.get(n) as Range]));
      if (style || part.tokens.length) {
        for (const m of text.slice(a, b).matchAll(/:root\s*\{[^}]*\}/g)) add(f, "the tokens", [{ start: a + (m.index ?? 0), end: a + (m.index ?? 0) + m[0].length, note: ":root tokens" }]);
      }
    }
    for (const [a, b] of js) {
      const fns = functions(text, a, b)
        .map((fn) => ({ ...fn, score: fnScore(fn, text, cls, part.id, request) }))
        .filter((fn) => fn.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, motion ? MAX_FUNCTIONS + 2 : MAX_FUNCTIONS);
      fns.forEach((fn) => add(f, "the code that moves it", [{ start: fn.start, end: fn.end, note: `function ${fn.name}` }]));
    }
    if (!sources.has(f)) add(f, "the part's file (nothing found to slice)", "whole");
  }

  // 2b. Other stylesheets the page says style the part: a rule there that sets the same thing as one of the part's own
  // rules (it may win over a change made in the part's file, or lose to it), and the layout of the element around it.
  // Only those rules, never the whole file. A shared rule that sets something the part's own rules don't touch (a
  // utility class) stays out: it costs tokens on every request and rarely matters to the change.
  if (page) {
    // Two declarations set "the same thing" when they are the same property or belong to one shorthand (padding-top
    // and padding, font-size and font); text-transform and text-align are not the same thing
    const SHORTHAND = /^(margin|padding|border|background|font|grid|flex|transition|animation|overflow|outline|list-style|place|mask|inset|gap)(-|$)/;
    const family = (prop: string) => (/^(top|right|bottom|left)$/.test(prop) ? "inset" : /^(row|column)-gap$/.test(prop) ? "gap" : (prop.match(SHORTHAND)?.[1] ?? prop));
    const sets = (body: string) => new Set([...body.matchAll(/(?:^|[;{\s])(--[\w-]+|[a-z-]+)\s*:/g)].map((m) => family(m[1])));
    const ownSets = new Set<string>();
    for (const f of own) for (const { rule, around } of rulesFromPage(f, view(f), page.get(f) ?? []).hits) if (!around) sets(rule.body).forEach((x) => ownSets.add(x));
    for (const [f, asked] of page) {
      if (own.includes(f) || sources.has(f) || !files.includes(f) || !asked.length) continue;
      for (const { rule: r, around } of rulesFromPage(f, view(f), asked).hits) {
        if (!around && ![...sets(r.body)].some((x) => ownSets.has(x))) continue;
        add(f, around ? "the layout around it" : "a rule elsewhere that sets the same thing", [
          { start: r.start, end: r.end, note: `CSS ${r.selector.slice(0, 60)}${r.media ? ` inside ${r.media}` : ""}${around ? " (lays out the element around it)" : " (another stylesheet's rule for the same element)"}` },
        ]);
      }
    }
  }

  // 3. Tokens file, when the request is about looks or the part uses tokens
  const tf = map.tokensFile;
  if (tf && files.includes(tf) && !sources.has(tf) && (style || part.tokens.length)) {
    const text = view(tf);
    if (text.length <= WHOLE_BELOW) add(tf, "the tokens", "whole");
    else
      [...text.matchAll(/:root\s*\{[^}]*\}/g)].forEach((m, i) => {
        // With the page's rules known: the block new tokens go into, and any block that sets a value those rules use
        // (not every breakpoint's block). Without: all of them, as before.
        const sets = [...m[0].matchAll(/(--[\w-]+)\s*:/g)].map((d) => d[1]);
        if (!page || i === 0 || sets.some((t) => usedTokens.has(t))) add(tf, "the tokens", [{ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, note: ":root tokens" }]);
      });
  }

  // 4. Motion or words requests reach the files that hold those, when they mention this part
  const extras = (map.extraFiles ?? []).filter((f) => files.includes(f) && !sources.has(f));
  for (const f of extras) {
    const text = view(f);
    const aboutPart = mentions(text, [...classes], part.id) > 0;
    const isWords = map.content?.file === f || /content|copy|words|i18n|strings/i.test(f);
    if ((motion && aboutPart && !isWords) || (words && isWords)) {
      if (text.length <= WHOLE_BELOW) add(f, motion && !isWords ? "the motion" : "the words", "whole");
      else {
        const { js } = regions(f, text);
        const fns = js
          .flatMap(([a, b]) => functions(text, a, b))
          .map((fn) => ({ ...fn, score: fnScore(fn, text, [...classes], part.id, request) }))
          .filter((fn) => fn.score > 0)
          .sort((x, y) => y.score - x.score);
        if (fns.length) fns.slice(0, MAX_FUNCTIONS).forEach((fn) => add(f, "the motion", [{ start: fn.start, end: fn.end, note: `function ${fn.name}` }]));
        else add(f, motion ? "the motion" : "the words", "whole");
      }
    }
  }
  if (words && map.content?.file && files.includes(map.content.file) && !sources.has(map.content.file)) add(map.content.file, "the words", "whole");

  return [...sources.values()].map((s) => ({ ...s, ranges: s.whole ? [] : merge(s.ranges) }));
}

// --- sending and applying

const lineOf = (text: string, at: number) => text.slice(0, at).split("\n").length;

export function render(sources: Source[], view: (file: string) => string): string {
  return sources
    .map((s) => {
      const text = view(s.file);
      if (s.whole) return `<file path="${s.file}">\n${text}\n</file>`;
      const slices = s.ranges
        .map((r) => `<slice lines="${lineOf(text, r.start)}-${lineOf(text, r.end)}" note="${r.note.replace(/"/g, "'")}">\n${text.slice(r.start, r.end)}\n</slice>`)
        .join("\n");
      return `<file path="${s.file}" view="slices">\n${slices}\n</file>`;
    })
    .join("\n\n");
}

export const sentChars = (sources: Source[], view: (file: string) => string) =>
  sources.reduce((n, s) => n + (s.whole ? view(s.file).length : s.ranges.reduce((m, r) => m + r.end - r.start, 0)), 0);

// Where an edit's "find" is: exactly once inside what was sent of that file (or, failing that, exactly once in the
// whole file). Returns the offset, or a reason it can't be placed.
export function locate(text: string, find: string, source: Source | undefined): number | string {
  if (!find) return "an empty find";
  if (source && !source.whole) {
    const hits: number[] = [];
    for (const r of source.ranges) {
      const piece = text.slice(r.start, r.end);
      for (let at = piece.indexOf(find); at >= 0; at = piece.indexOf(find, at + 1)) hits.push(r.start + at);
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return "matched more than once in what was sent";
  }
  const at = text.indexOf(find);
  if (at < 0) return "didn't match the file";
  if (text.indexOf(find, at + 1) >= 0) return "matched more than once";
  return at;
}

// A file's edits, placed together. Each find is looked for in the file as it was sent (inside its slices first), so a
// second edit in a sliced file is still matched where Claude saw it: looked for in the whole file, a find that was
// unique in the slices can repeat elsewhere ("font-weight:600; font-size:16px;" four times) and the change was lost.
// Only a find that isn't in the file as sent is looked for after the others are made (Claude built on its own earlier
// edit). Returns the new text, or why an edit can't be placed.
export function placeEdits(text: string, edits: { find: string; replace: string }[], source: Source | undefined): string | { why: string } {
  const placed: { at: number; find: string; replace: string }[] = [];
  const later: { find: string; replace: string }[] = [];
  for (const e of edits) {
    const at = locate(text, e.find, source);
    if (typeof at === "number") placed.push({ at, find: e.find, replace: e.replace });
    else if (at === "didn't match the file" && placed.length) later.push(e);
    else return { why: at };
  }
  placed.sort((a, b) => a.at - b.at);
  for (let i = 1; i < placed.length; i++) if (placed[i].at < placed[i - 1].at + placed[i - 1].find.length) return { why: "overlaps another edit of the same answer" };
  let out = text;
  for (const e of [...placed].reverse()) out = out.slice(0, e.at) + e.replace + out.slice(e.at + e.find.length);
  for (const e of later) {
    const at = locate(out, e.find, undefined);
    if (typeof at === "string") return { why: at };
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return out;
}
