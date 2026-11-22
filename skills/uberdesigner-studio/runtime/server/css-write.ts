// Writing values into a stylesheet as text: one declaration in a rule, a layer's own rule (under its tag or its
// selector address), and the check that a write leaves every rule closed. No file access here: text in, text out.

import { ruleRe, ruleSelector, selectorProblem, selectorsOf } from "./address.ts";
import { bracesBalance } from "./values.ts";

// An HTML file with everything outside its <style> blocks blanked out (same length, so offsets still match)
export function onlyStyles(html: string): string {
  let out = "";
  let at = 0;
  for (const m of html.matchAll(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi)) {
    const start = (m.index ?? 0) + m[1].length;
    out += " ".repeat(start - at) + m[2];
    at = start + m[2].length;
  }
  return out + " ".repeat(html.length - at);
}

export const TOKEN_NAME = /^--[\w-]+$/;
export const TOKEN_VALUE = /^[^;{}]+$/;
// Properties a layer takes from the one it sits in; the panel offers the outer layer's tokens for these (panel-src
// inspector/inherited.ts keeps the same list)
export const INHERITED = new Set(["font-size", "font-family", "font-weight", "font-style", "font-stretch", "letter-spacing", "line-height", "color", "text-transform", "word-spacing"]);

// The text the CSS rules live in, with everything else blanked to spaces (same length, so indexes match): a .css file
// is all CSS; for an HTML file, its <style> blocks. Comments are blanked too.
export const cssMask = (file: string, text: string) => (/\.html?$/.test(file) ? onlyStyles(text) : text).replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
export const depthAt = (masked: string, at: number) => {
  const before = masked.slice(0, at);
  return (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
};
// Set a declaration in a rule's body ("{ … }"), replacing the one there or adding it before the closing brace
export function setDeclaration(rule: string, name: string, value: string): string {
  const re = new RegExp(`((?:^|[\\s;{])${name}\\s*:\\s*)([^;}]+)(;?)`);
  if (re.test(rule)) return rule.replace(re, (_m, a: string, old: string) => `${a}${value};${old.match(/\s*$/)?.[0] ?? ""}`);
  const body = rule.slice(0, rule.lastIndexOf("}")).replace(/\s*$/, "");
  const indent = rule.match(/\n(\s*)--/)?.[1] ?? "  ";
  return `${body}${/[;{]$/.test(body) ? "" : ";"}\n${indent}${name}: ${value};\n${indent.slice(2)}}`;
}

// A layer's own values, saved after the site's :root blocks as one rule, under the layer's tag ([data-dm="…"]) or, for
// a layer found by a selector, under that selector (address.ts ruleSelector): the element-level value wins over
// the site-wide token for that layer and everything inside it. Edits are desktop values, so for a token with a phone
// value (a :root inside a media query) the same media query gets the layer's rule with that phone value, unless the
// layer already has its own phone value: phones look as they did.
// The end (the offset of </style>) of the <style> block a layer's own values go into, or -1
export function htmlStyleEnd(t: string): number {
  const lower = t.toLowerCase();
  const blocks: { end: number; root: boolean }[] = [];
  for (const m of t.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const start = m.index ?? 0;
    const before = lower.slice(0, start);
    if (["noscript", "template", "svg"].some((tag) => before.lastIndexOf(`<${tag}`) > before.lastIndexOf(`</${tag}>`))) continue;
    blocks.push({ end: start + m[0].length - "</style>".length, root: /:root\s*\{/.test(m[1]) });
  }
  const pick = [...blocks].reverse().find((b) => b.root) ?? blocks.at(-1);
  return pick ? pick.end : -1;
}

export function savePartTokens(file: string, text: string, part: { id: string; label?: string; targets?: unknown[] }, values: Record<string, string>): string {
  if (!/^[\w-]+$/.test(part.id)) throw new Error(`Not a part id: ${part.id}`);
  for (const s of selectorsOf(part)) {
    const why = selectorProblem(s);
    if (why) throw new Error(`${part.label ?? part.id} wasn't saved: its address in the map (${s}) can't be used: ${why}. Nothing was written.`);
  }
  let next = text;
  const selector = ruleSelector(part);
  const own = ruleRe(selector);
  // Where new rules go: the end of a CSS file, or, in HTML, the end of the <style> that holds the :root tokens (else the
  // last <style>). Never a <style> inside <noscript>, <template> or <svg>: the page ignores those when scripts run.
  const endOfCss = (t: string) => (/\.html?$/.test(file) ? htmlStyleEnd(t) : t.length);
  const insert = (t: string, piece: string) => {
    const at = endOfCss(t);
    if (at < 0) throw new Error(`${file} has no <style> block to save into`);
    return t.slice(0, at).replace(/\s*$/, "\n") + piece + t.slice(at);
  };
  for (const [name, value] of Object.entries(values)) {
    // A token, or (for a layer inside the one whose rule uses the token) the inherited property that reads it again
    // here, so the layer's own value takes effect: font-size: var(--fs-name)
    const relay = INHERITED.has(name) && /^var\(--[\w-]+\)$/.test(value.trim());
    if (!relay && (!TOKEN_NAME.test(name) || !TOKEN_VALUE.test(value))) throw new Error(`Not a token value: ${name}: ${value}`);
    // Desktop: the layer's top-level rule
    let masked = cssMask(file, next);
    const top = [...masked.matchAll(own)].find((m) => depthAt(masked, m.index ?? 0) === 0);
    if (top && top.index !== undefined) {
      const rule = next.slice(top.index, top.index + top[0].length);
      next = next.slice(0, top.index) + setDeclaration(rule, name, value.trim()) + next.slice(top.index + top[0].length);
    } else {
      next = insert(next, `\n/* Set for one layer in uberdesigner studio */\n${selector} {\n  ${name}: ${value.trim()};\n}\n`);
    }
    // Phones: the media query whose :root sets this token
    if (relay) continue;
    masked = cssMask(file, next);
    const phoneRoot = [...masked.matchAll(/:root\s*\{[^}]*\}/g)]
      .filter((m) => depthAt(masked, m.index ?? 0) > 0)
      .reverse()
      .find((m) => new RegExp(`(?:^|[\\s;{])${name}\\s*:`).test(m[0]));
    if (!phoneRoot || phoneRoot.index === undefined) continue;
    const mediaAt = masked.lastIndexOf("@media", phoneRoot.index);
    if (mediaAt < 0) continue;
    const prelude = masked.slice(mediaAt, masked.indexOf("{", mediaAt)).trim();
    const phoneValue = phoneRoot[0].match(new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;}]+)`))?.[1].trim();
    if (!phoneValue) continue;
    const phone = [...masked.matchAll(own)].find((m) => {
      if (depthAt(masked, m.index ?? 0) === 0) return false;
      const at = masked.lastIndexOf("@media", m.index);
      return at >= 0 && masked.slice(at, masked.indexOf("{", at)).trim() === prelude;
    });
    if (phone && phone.index !== undefined) {
      if (new RegExp(`(?:^|[\\s;{])${name}\\s*:`).test(phone[0])) continue; // the layer's own phone value stays
      const rule = next.slice(phone.index, phone.index + phone[0].length);
      next = next.slice(0, phone.index) + setDeclaration(rule, name, phoneValue) + next.slice(phone.index + phone[0].length);
    } else {
      next = insert(next, `${prelude} {\n  ${selector} {\n    ${name}: ${phoneValue};\n  }\n}\n`);
    }
  }
  return next;
}

// A write must leave the stylesheet's rules closed: if the braces balanced before, they balance after. The values are
// checked before they're written (values.ts), so this only ever catches a mistake in the inspector's own writing.
export const cssIntact = (file: string, before: string, after: string) => !bracesBalance(cssMask(file, before)) || bracesBalance(cssMask(file, after));
