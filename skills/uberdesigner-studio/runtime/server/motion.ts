// Motion written as plain CSS (a transition's or an animation's duration, delay, easing): the panel reads it from the
// page, and a change is written straight into its rule.

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { htmlEntry } from "./adapters.ts";
import { valueProblem } from "./values.ts";
import { cssIntact, cssMask, setDeclaration } from "./css-write.ts";
import { directOrClaude, type DirectRequest, partOf } from "./direct-changes.ts";
import { EDITABLE, readSite, ROOT } from "./site.ts";

// --- Motion written as plain CSS (a transition's or an animation's duration, delay, easing): the panel reads it from the
// page and names the rule it comes from; the value is written into that rule (a longhand after any shorthand, which
// wins), with no Claude call when the rule is found once.
export type MotionRequest = DirectRequest & { source: string; selector: string; media?: string; prop: string; value: string };
export const MOTION_PROPS = /^(transition|animation)-(duration|delay|timing-function)$/;
export const normSelector = (s: string) => s.replace(/\s+/g, " ").replace(/\s*([>+~,])\s*/g, "$1").replace(/\s*\(\s*/g, "(").replace(/\s*\)/g, ")").trim();
export const normMedia = (s: string) => s.replace(/^@media\s*/i, "").replace(/\s+/g, "").toLowerCase();

// The site file a stylesheet came from: Vite's dev id (an absolute path), or the page the <style> sits in
export function motionFile(source: string): string | null {
  const s = source.split("?")[0];
  if (s.startsWith(ROOT + "/")) return relative(ROOT, s).replace(/\\/g, "/");
  const rel = decodeURIComponent(s.replace(/^\/+/, ""));
  if (!rel) return htmlEntry(ROOT) ?? null;
  for (const f of [rel, `${rel}.html`, `${rel.replace(/\/$/, "")}/index.html`]) if (existsSync(join(ROOT, f)) && EDITABLE.test(f)) return f;
  return null;
}

// The one rule with this selector (inside this media query, or at the top level) in a stylesheet or a page's <style>
export function setMotionValue(file: string, text: string, selector: string, media: string, prop: string, value: string): string | { why: string } {
  const masked = cssMask(file, text);
  const want = normSelector(selector);
  const wantMedia = normMedia(media);
  const hits: [number, number][] = [];
  const walk = (start: number, end: number, at: string) => {
    let i = start;
    while (i < end) {
      const open = masked.indexOf("{", i);
      if (open < 0 || open >= end) return;
      const prelude = masked.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < end && depth) {
        if (masked[j] === "{") depth++;
        else if (masked[j] === "}") depth--;
        j++;
      }
      if (/^@(media|supports|container|layer)\b/i.test(prelude)) walk(open + 1, j - 1, /^@media/i.test(prelude) ? normMedia(prelude) : at);
      else if (prelude && !prelude.startsWith("@") && at === wantMedia && normSelector(prelude) === want) hits.push([i + (masked.slice(i, open).length - masked.slice(i, open).trimStart().length), j]);
      i = j;
    }
  };
  walk(0, masked.length, "");
  if (hits.length !== 1) return { why: hits.length ? `the rule ${selector} is written ${hits.length} times in ${file}` : `the rule ${selector} isn't in ${file} as written` };
  const [a, b] = hits[0];
  const rule = text.slice(a, b);
  return text.slice(0, a) + (inShorthand(rule, prop, value) ?? setDeclaration(rule, prop, value)) + text.slice(b);
}

// A duration or delay changed inside the rule's own shorthand (transition: transform 0.45s var(--ease)), so the file
// keeps one declaration: the first time of each item is its duration, the second its delay. Null when the rule has the
// longhand already, no shorthand, or a shorthand this can't read (then the longhand goes after it, which wins).
export function inShorthand(rule: string, prop: string, value: string): string | null {
  const m = prop.match(/^(transition|animation)-(duration|delay)$/);
  if (!m) return null;
  const [, kind, what] = m;
  if (new RegExp(`(?:^|[\\s;{])${prop}\\s*:`).test(rule)) return null;
  const decl = rule.match(new RegExp(`((?:^|[\\s;{])${kind}\\s*:\\s*)([^;}]+)`));
  if (!decl) return null;
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of decl[2]) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      items.push(cur);
      cur = "";
    } else cur += c;
  }
  items.push(cur);
  const values = value.split(",").map((v) => v.trim());
  if (values.length !== items.length) return null;
  const TIME = /(^|\s)(-?\d*\.?\d+m?s)(?=\s|$)/g;
  const next = items.map((item, i) => {
    const times = [...item.matchAll(TIME)];
    const at = what === "duration" ? times[0] : times[1];
    if (at) return item.slice(0, (at.index ?? 0) + at[1].length) + values[i] + item.slice((at.index ?? 0) + at[0].length);
    if (what === "delay" && times[0]) {
      const end = (times[0].index ?? 0) + times[0][0].length;
      return `${item.slice(0, end)} ${values[i]}${item.slice(end)}`;
    }
    return null;
  });
  if (next.some((x) => x === null)) return null;
  const start = (decl.index ?? 0) + decl[1].length;
  return rule.slice(0, start) + next.join(",") + rule.slice(start + decl[2].length);
}

export function setMotion(d: MotionRequest) {
  const part = partOf(d.partId);
  if (!MOTION_PROPS.test(d.prop)) throw new Error(`Not a motion value: ${d.prop}`);
  const unsafe = /^[\w\s.,()%+-]+$/.test(d.value) ? valueProblem(d.value) : "only numbers, units and easing names fit here";
  if (unsafe) throw new Error(`${d.prop} wasn't saved: ${unsafe}. Nothing was written.`);
  const file = motionFile(d.source);
  const request = `Set ${d.prop} to ${d.value} on ${d.selector}${d.media ? ` (${d.media})` : ""} for ${part.label}`;
  return directOrClaude(
    d,
    request,
    () => {
      if (!file) return { why: "the stylesheet isn't one of the site's files" };
      const text = readSite(file);
      if (text === null) return { why: `${file} can't be read` };
      const next = setMotionValue(file, text, d.selector, d.media ?? "", d.prop, d.value);
      if (typeof next !== "string") return next;
      if (!cssIntact(file, text, next)) return { why: `writing it would leave ${file} with an unclosed rule` };
      return { files: new Map([[file, next]]), summary: `Set ${d.prop} to ${d.value} on ${d.selector} in ${file}, with no Claude call.` };
    },
    (why) => `${request}${file ? `, in ${file}` : ""}. (The studio couldn't do it directly: ${why}.)`,
  );
}
