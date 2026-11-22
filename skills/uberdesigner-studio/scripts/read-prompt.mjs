#!/usr/bin/env node
// design-map step 2: split a build prompt into sections. No tokens spent.
//   node read-prompt.mjs <prompt.md> [--project <dir>] [--out file]
//   node read-prompt.mjs <prompt.md> --section "3. Hero" [--prose]
// Markdown headings become a tree of sections, each with its path ("Layout › 3. Hero"), line range, size, how much of
// it is code, and its opening; tables are listed one by one with all their columns. Bold-labelled paragraphs or
// bullets inside a section ("**Typography.** …", "- **Headline**: …") become subsections, so they can be quoted with a
// real path. --section prints one section (or subsection) in full; --prose drops its code blocks.
// Default --out: <project>/.inspector/map-work/prompt.json when --project is given, else prompt.json next to the prompt.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail, workDir } from "./lib.mjs";

const args = process.argv.slice(2);
const val = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const file = args.find((a, i) => !a.startsWith("--") && !["--out", "--section", "--project"].includes(args[i - 1]));
if (!file) fail("pass the prompt file: node read-prompt.mjs prompt.md");
const only = val("--section");
const prose = args.includes("--prose");
const out = val("--out") ?? (val("--project") ? join(workDir(val("--project")), "prompt.json") : join(dirname(file), "prompt.json"));

const raw = readFileSync(file, "utf8");
const lines = raw.replace(/\n$/, "").split("\n");

// Code fences, tracking the fence's length so a ```` block can hold ``` blocks
const inCode = new Array(lines.length).fill(false);
let fence = null;
lines.forEach((line, i) => {
  const m = line.match(/^\s*(`{3,}|~{3,})/);
  if (fence) {
    inCode[i] = true;
    if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
  } else if (m) {
    fence = m[1];
    inCode[i] = true;
  }
});

// Sections from headings
const sections = [];
const stack = [];
const short = (t) => t.replace(/`/g, "").replace(/\s+[—–]\s+.*$/, "").replace(/\s*\(.*?\)\s*$/, "").trim();
lines.forEach((line, i) => {
  const h = !inCode[i] && line.match(/^(#{1,4})\s+(.+?)\s*$/);
  if (!h) return;
  const level = h[1].length;
  while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
  const title = h[2].replace(/`/g, "");
  const trail = [...stack.filter((s) => s.level > 1), { title }].map((s) => short(s.title));
  const section = { level, title, path: trail.join(" › "), start: i + 1, end: lines.length };
  for (const s of sections) if (s.end === lines.length && s.level >= level) s.end = i;
  sections.push(section);
  stack.push(section);
});

// Subsections from bold labels at the start of a paragraph or bullet, inside the deepest sections
const subs = [];
for (const s of sections) {
  const childStart = sections.find((c) => c.start > s.start && c.start <= s.end && c.level > s.level)?.start ?? s.end + 1;
  let current = null;
  for (let i = s.start; i < Math.min(s.end, childStart - 1); i++) {
    if (inCode[i]) continue;
    const m = lines[i].match(/^(?:\s*[-*]\s+)?\*\*([^*]{2,60}?)[.:]?\*\*[.:]?(\s|$)/);
    if (m) {
      if (current) current.end = i;
      current = { level: s.level + 1, title: m[1].trim(), path: `${s.path} › ${m[1].trim()}`, start: i + 1, end: Math.min(s.end, childStart - 1), sub: true };
      subs.push(current);
    }
  }
}

const all = [...sections, ...subs].sort((a, b) => a.start - b.start || a.level - b.level);
const text = (s, onlyProse) =>
  lines
    .slice(s.start, s.end)
    .filter((_, k) => !onlyProse || !inCode[s.start + k])
    .join("\n")
    .trim();
const codeShare = (s) => {
  const n = s.end - s.start;
  return n ? inCode.slice(s.start, s.end).filter(Boolean).length / n : 0;
};

if (only) {
  const s = all.find((x) => x.path.endsWith(only) || x.title.startsWith(only) || x.path === only);
  if (!s) fail(`No section "${only}". Sections: ${all.map((x) => x.path).join(" | ")}`);
  const body = text(s, prose);
  console.log(`${s.path} (lines ${s.start}–${s.end}${prose ? ", code blocks left out" : ""})\n\n${body}`);
  process.exit(0);
}

// Tables, one by one, with every column
const tables = [];
for (let i = 0; i < lines.length; i++) {
  if (inCode[i] || !/^\s*\|/.test(lines[i]) || !/^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? "")) continue;
  const head = lines[i].split("|").slice(1, -1).map((c) => c.trim().replace(/`/g, ""));
  const rows = [];
  let j = i + 2;
  for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(lines[j].split("|").slice(1, -1).map((c) => c.trim().replace(/`/g, "").slice(0, 80)));
  const owner = [...all].reverse().find((s) => s.start <= i + 1 && s.end >= i + 1);
  tables.push({ in: owner?.path ?? "(top)", line: i + 1, columns: head, rows: rows.slice(0, 40) });
  i = j;
}

const v1Comment = /uberdesigner prompt format v1/i.test(raw.slice(0, 2000));
const hasLayout = sections.some((s) => /^Layout\b/.test(s.title));
const hasMotion = sections.some((s) => /^M\d+\b/.test(s.title) || /^Motion\b/.test(s.title));
const result = {
  file,
  lines: lines.length,
  format: v1Comment || (hasLayout && hasMotion) ? "uberdesigner-v1" : "markdown",
  layout: hasLayout ? "Layout sections describe the page part by part: read them in full." : "No Layout section: look for the parts in Goal, the section names and the code.",
  sections: all.map((s) => {
    const body = text(s, false);
    const chars = body.length;
    const code = codeShare(s);
    const opening = text(s, true).split("\n").filter((l) => !/^\s*\|/.test(l)).join(" ").replace(/\s+/g, " ").slice(0, 240);
    return {
      path: s.path,
      lines: `${s.start}–${s.end}`,
      chars,
      ...(code > 0.3 ? { code: `${Math.round(code * 100)}%` } : {}),
      ...(chars > 20000 ? { large: "large: read with --prose, or skip if it's code or content" } : {}),
      ...(s.sub ? { sub: true } : {}),
      opening,
    };
  }),
  tables,
};

const json = JSON.stringify(result, null, 1);
writeFileSync(out, json + "\n");
console.log(
  `uberdesigner-studio prompt: ${result.format}, ${sections.length} sections + ${subs.length} labelled subsections, ${tables.length} tables, ` +
    `from ${lines.length} lines → ${out} (~${Math.round(json.length / 3.6 / 1000)}k tokens to read)`,
);
