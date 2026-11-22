#!/usr/bin/env node
// design-map step 5: check the map against the project. No tokens spent.
//   node verify.mjs <project> [--no-typecheck]
// Errors: missing files or tokens, parts not tagged in the code, a selector address that can't be used, undescribed or unlabelled tokens, inspector not wired, typecheck.
// Warnings: things that pass the code check but may not work on the page (a tag on a component that may not pass it
// on, a tagged element with display: contents, tokens the site's code overrides, oversized edit lists, prompt quotes
// whose "where" isn't a section, a custom cursor that would catch every click). Exit code 1 on any error.
// A pass means the map is consistent with the code; the outlines still need a look in the browser (SKILL.md step 5).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCode, cssOf, htmlTags, isHtmlSite, loadTypeScript, projectDir, read, requireSupported, scriptText, sourceFiles, tokenSets } from "./lib.mjs";
import { scriptsIn } from "../runtime/server/script-check.ts";
import { EDITABLE } from "../runtime/server/site.ts"; // the server's own rule for what may be edited
import { OLD_TAG, TAG, anchorsOf, ruleRe, ruleSelector, selectorProblem, selectorsOf, tagTargetsOf, tagsIn } from "../runtime/server/address.ts";

const args = process.argv.slice(2);
const dir = projectDir(args.find((a) => !a.startsWith("--")));
requireSupported(dir);
const errors = [];
const warnings = [];
const waiting = []; // layers removed in the inspector, or added by a change that was undone
const ok = [];
const HERE = dirname(fileURLToPath(import.meta.url));

const mapPath = join(dir, "inspector.map.json");
if (!existsSync(mapPath)) {
  console.error("uberdesigner-studio verify: no inspector.map.json (run apply first)");
  process.exit(1);
}
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const clean = (f) => f.replace(/\s*\(.*\)$/, "");
const exists = (f) => existsSync(join(dir, clean(f)));
const htmlSite = isHtmlSite(dir);
const isMarkup = (f) => /\.html?$/.test(f);
const src = sourceFiles(dir);

// --- tokens
const tokenNames = new Set();
if (map.tokensFile) {
  if (!exists(map.tokensFile)) errors.push(`tokensFile ${map.tokensFile} doesn't exist`);
  else {
    const { base, media } = tokenSets(cssOf(map.tokensFile, read(dir, map.tokensFile)));
    [...Object.keys(base), ...Object.keys(media)].forEach((n) => tokenNames.add(n));
  }
}
const described = new Set(Object.keys(map.tokens ?? {}));
for (const name of described) if (!tokenNames.has(name)) errors.push(`token ${name} is described but isn't in ${map.tokensFile}`);
// The editor shows a token by its label; without one it falls back to the prompt's sentence or the code name
const unlabelled = [...described].filter((n) => !String(map.tokens[n]?.label ?? "").trim());
if (unlabelled.length) {
  errors.push(
    `${unlabelled.length} token(s) have no label, so the editor shows code names or prompt sentences: give each a plain name of two to four words ("Headline font", "Name text size", "Page background") — ${unlabelled.join(", ")}`,
  );
}
const longLabels = Object.entries(map.tokens ?? {}).filter(([, t]) => String(t?.label ?? "").split(/\s+/).length > 5);
if (longLabels.length) warnings.push(`labels longer than five words read as sentences in the editor: ${longLabels.map(([n, t]) => `${n} "${t.label}"`).join(", ")}`);
if (!described.size && map.parts.some((p) => p.tokens.length)) errors.push("parts list tokens but the map's tokens dictionary is empty");

// tokens the site's code overrides at runtime
const overrides = src
  .filter((f) => /\.(tsx?|jsx?|m?js)$/.test(f) || isMarkup(f))
  .flatMap((f) => (isMarkup(f) ? scriptText(read(dir, f)) : read(dir, f)).split("\n").map((l, i) => ({ f, i: i + 1, l })))
  .filter(({ l }) => /setProperty\(/.test(l) && /(documentElement|document\.body|:root)/.test(l));
if (overrides.length && !(map.facts ?? []).some((f) => /overrid/i.test(f))) {
  warnings.push(`the site sets tokens from code (${overrides.map((o) => `${o.f}:${o.i}`).join(", ")}): add a fact saying which tokens and where to change them, or the panel's saves won't show`);
}

// --- words
let words = null;
if (map.content?.file) {
  if (!exists(map.content.file)) errors.push(`words file ${map.content.file} doesn't exist`);
  else words = JSON.parse(read(dir, map.content.file));
}

// --- where the tags (data-dm) are, and on what (parsed, so components and wrappers can be checked)
const ts = src.some((f) => /\.(tsx|jsx)$/.test(f)) ? loadTypeScript(dir) : null;
const tagged = new Map(); // id -> [{ file, tag, className }]
for (const f of src.filter(isMarkup)) {
  for (const t of htmlTags(read(dir, f))) {
    const part = t.attrs[TAG];
    if (part) tagged.set(part, [...(tagged.get(part) ?? []), { file: f, tag: t.tag, cls: (t.attrs.class ?? "").split(/\s+/).map((c) => `styles.${c}`).join(" ") }]);
  }
}
for (const f of src.filter((f) => /\.(tsx|jsx)$/.test(f) && ts)) {
  const text = read(dir, f);
  if (!text.includes(`${TAG}=`)) continue;
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const props = n.attributes.properties.filter(ts.isJsxAttribute);
      const part = props.find((a) => a.name.getText(sf) === TAG)?.initializer?.getText(sf).replace(/^\{?\s*["'`]|["'`]\s*\}?$/g, "");
      if (part) {
        const cls = props.find((a) => a.name.getText(sf) === "className")?.initializer?.getText(sf) ?? "";
        tagged.set(part, [...(tagged.get(part) ?? []), { file: f, tag: n.tagName.getText(sf), cls }]);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// Old tags (data-part="<a part's id>") in the code of a map that has been renamed: files from before the rename came
// back (a History version that old was restored)
const oldTagged = new Set(src.filter((f) => isMarkup(f) || /\.(tsx|jsx)$/.test(f)).flatMap((f) => tagsIn(read(dir, f), OLD_TAG)));

// CSS module classes with display: contents (no box of their own: never outlined)
const contents = new Set();
for (const f of src.filter((f) => f.endsWith(".css") || isMarkup(f))) {
  for (const r of cssOf(f, read(dir, f)).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*display\s*:\s*contents[^{}]*)\}/g)) {
    for (const m of r[1].matchAll(/\.([\w-]+)/g)) contents.add(m[1]);
  }
}

// prompt sections, to check each quote's "where"
let sectionPaths = null;
const promptFile = map.source?.prompt && exists(map.source.prompt) ? join(dir, map.source.prompt) : null;
if (promptFile) {
  const r = spawnSync(process.execPath, [join(HERE, "read-prompt.mjs"), promptFile, "--out", join(dir, ".inspector", "map-work", "verify-prompt.json")], { encoding: "utf8" });
  if (r.status === 0) {
    sectionPaths = JSON.parse(readFileSync(join(dir, ".inspector", "map-work", "verify-prompt.json"), "utf8")).sections.map((s) => s.path);
  }
}
const whereOk = (where) => !sectionPaths || sectionPaths.some((p) => where === p || where.startsWith(p + " ›") || p.startsWith(where));

// What a part's file costs per request: its size with embedded data (base64 fonts, images) left out, as the server
// sends it
const sentBytes = (f) => {
  const text = read(dir, f);
  return Buffer.byteLength(text) - (text.match(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g) ?? []).reduce((n, m) => n + m.length, 0);
};

// The runtime's own context picker, so the size reported is the size sent (Node 23.6+ runs the .ts file as is)
const slices = await import(new URL("../runtime/server/slices.ts", import.meta.url).href).catch(() => null);
const view = (f) => read(dir, f).replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g, "data:…[kept by the inspector]");
const editable = [...new Set([...src, ...(!htmlSite && existsSync(join(dir, "index.html")) ? ["index.html"] : [])])].filter((f) => EDITABLE.test(f));
const sentSizes = [];
const forwards = new Set(map.parts.flatMap((p) => (p.targets ?? []).filter((t) => t.forwards).map(() => p.id)));

// --- nesting: parents that exist, no loops; kinds the editor knows
const KINDS = new Set(["section", "frame", "text", "image", "video", "button", "icon", "scene", "list"]);
const byId = new Map(map.parts.map((p) => [p.id, p]));
for (const p of map.parts) {
  if (p.kind !== undefined && !KINDS.has(p.kind)) errors.push(`${p.id}: kind "${p.kind}" isn't one of ${[...KINDS].join(", ")}`);
  if (p.parent === undefined) continue;
  if (!byId.has(p.parent)) errors.push(`${p.id}: parent "${p.parent}" isn't a part of the map`);
  const seen = new Set([p.id]);
  for (let q = byId.get(p.parent); q; q = q.parent ? byId.get(q.parent) : undefined) {
    if (seen.has(q.id)) {
      errors.push(`${p.id}: its parents loop back to ${q.id}`);
      break;
    }
    seen.add(q.id);
  }
}
// A layer lists its own tokens: one that lists every token of its nested parts too shows their settings when picked
for (const p of map.parts) {
  const kids = map.parts.filter((c) => c.parent === p.id);
  const inherited = p.tokens.filter((t) => kids.some((c) => c.tokens.includes(t)));
  if (kids.length && inherited.length === p.tokens.length && p.tokens.length > 2)
    warnings.push(`${p.id}: lists only tokens its nested parts list too (${inherited.join(", ")}): keep the ones its own rules use`);
}
// An effect's settings: each must find exactly one number in its file (a named constant, or the number after "find")
const directLib = await import(new URL("../runtime/server/direct.ts", import.meta.url).href).catch(() => null);
for (const p of map.parts) {
  for (const s of p.params ?? []) {
    const what = s.name ?? `"${s.find}"`;
    if (!s.file || (!s.name && !s.find) || !s.label) errors.push(`${p.id}: a setting needs file, label and name (a constant) or find (the code before the number)`);
    else if (!exists(s.file)) errors.push(`${p.id}: setting ${what}: ${s.file} doesn't exist`);
    else if (directLib && directLib.readNumber(read(dir, clean(s.file)), s) === null)
      errors.push(`${p.id}: setting ${what} finds no single number in ${s.file}${s.find ? " (find must appear exactly once, right before the number)" : " (it must be const NAME = <number>)"}`);
  }
}

// A map from before the studio had its own attribute: its tags are data-part, which this version doesn't read
if (map.tag !== TAG) errors.push(`this map's tags are ${OLD_TAG}="…", from before the studio had its own attribute (${TAG}): run apply again, it renames them`);
// Values saved for one layer (a rule in the tokens file that starts with its tag) whose part is gone, or whose part is
// now found by a selector (its values belong under that selector)
if (map.tokensFile && exists(map.tokensFile)) {
  const css = cssOf(map.tokensFile, read(dir, map.tokensFile)).replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of css.matchAll(new RegExp(`(?:^|[{};])\\s*\\[${TAG}="([\\w-]+)"\\]\\s*\\{`, "g"))) {
    const part = byId.get(m[1]);
    if (!part) warnings.push(`${map.tokensFile} keeps values for "${m[1]}", which isn't a part any more: remove that rule or add the part back`);
    else if (![...css.matchAll(ruleRe(ruleSelector(part)))].length) warnings.push(`${map.tokensFile} keeps values for "${m[1]}" under its tag, but the part is found by a selector now: move them to a rule under ${ruleSelector(part)}`);
  }
}

for (const p of map.parts) {
  let bytes = 0;
  for (const f of p.edit) {
    if (!EDITABLE.test(f)) errors.push(`${p.id}: edit file ${f} isn't a code or style file${htmlSite ? "" : " under src/ (or index.html)"}`);
    else if (!exists(f)) errors.push(`${p.id}: edit file ${f} doesn't exist`);
    else bytes += sentBytes(f);
  }
  if (!p.edit.length) warnings.push(`${p.id}: no edit files, so only whole-site changes can touch it`);
  // What a change to this part actually sends: the automatic context (runtime/server/slices.ts), not the whole files
  if (slices && bytes > 0) {
    const chars = slices.sentChars(slices.resolveContext(p, "", map, editable, view), view);
    sentSizes.push(chars);
    if (chars > 30000) warnings.push(`${p.id}: a change sends ~${Math.round(chars / 3600)}k tokens of code even after slicing; move big shared files to extraFiles`);
  }
  for (const t of p.tokens) {
    if (!tokenNames.has(t)) errors.push(`${p.id}: token ${t} isn't in ${map.tokensFile ?? "any tokens file"} (local variables aren't tokens)`);
    else if (!described.has(t)) errors.push(`${p.id}: token ${t} isn't described in the map's tokens`);
  }
  for (const k of p.content ?? []) if (words && !(k in words)) errors.push(`${p.id}: word key "${k}" isn't in ${map.content.file}`);
  for (const ref of p.prompt) if (!whereOk(ref.where) && ref.where !== "Added in the inspector" && map.source?.kind !== "code") warnings.push(`${p.id}: "${ref.where}" isn't a section of ${map.source.prompt}`);
  if (!p.prompt.length) warnings.push(`${p.id}: no prompt lines, so Claude gets no description of it`);
  const tags = tagged.get(p.id) ?? [];
  if ((p.removed || p.added) && !tags.length) {
    // Removed in the inspector, or added by a change that was undone: kept so Undo or History can bring it back
    waiting.push(p.id);
    continue;
  }
  // A part found by a selector: the selector must be usable, and start from a part that is tagged in the code
  const selectors = selectorsOf(p);
  for (const s of selectors) {
    const why = selectorProblem(s);
    if (why) errors.push(`${p.id}: its selector "${s}" can't be used: ${why}`);
    for (const around of anchorsOf(s)) if (!tagged.has(around)) errors.push(`${p.id}: its selector starts from ${TAG}="${around}", which nothing in the code carries`);
  }
  if (selectors.length && !tagTargetsOf(p).length && tags.length) warnings.push(`${p.id}: found by a selector, but ${tags.map((t) => t.file).join(", ")} still tags an element ${TAG}="${p.id}": run apply to remove it`);
  if (p.outline !== false && !tags.length && !selectors.length)
    errors.push(
      oldTagged.has(p.id) && map.tag === TAG
        ? `${p.id}: the code carries the old tag ${OLD_TAG}="${p.id}" and no ${TAG} (files from before the rename came back, as after restoring an old History version): run apply with --rename-old-tags`
        : `${p.id}: nothing on the page is tagged ${TAG}="${p.id}"`,
    );
  for (const t of tags) {
    if (/^[A-Z]/.test(t.tag) || t.tag.includes("."))
      warnings.push(
        forwards.has(p.id)
          ? `${p.id}: tagged on <${t.tag}> in ${t.file}, a component marked "forwards": the code can't show that it passes ${TAG} on. Open the editor: if the layer says "not on page", give it a selector address instead`
          : `${p.id}: tagged on <${t.tag}> in ${t.file}, a component: it only shows if <${t.tag}> passes ${TAG} on`,
      );
    const cls = [...t.cls.matchAll(/styles\.([\w-]+)/g)].map((m) => m[1]).find((c) => contents.has(c));
    if (cls && p.outline !== false) warnings.push(`${p.id}: tagged element .${cls} is display: contents somewhere, so it has no box to outline there`);
  }
  const hidden = p.hideWhileInspecting || (p.id === "cursor" && tags.length); // id "cursor" is always hidden while inspecting
  if (/cursor/i.test(p.id + " " + p.label) && !/light|glow/i.test(p.id + " " + p.label) && !hidden) {
    warnings.push(`${p.id}: a custom cursor follows the mouse over the page and the panel: set "hideWhileInspecting": true (and give it a target so it can be hidden)`);
  }
}
for (const id of tagged.keys()) if (!map.parts.some((p) => p.id === id)) warnings.push(`${TAG}="${id}" in ${tagged.get(id).map((t) => t.file).join(", ")} isn't a layer of the map: run apply to remove it`);
for (const f of map.extraFiles ?? []) if (!exists(f)) errors.push(`extra file ${f} doesn't exist`);
if (!map.facts?.length) warnings.push("no facts: Claude won't be told where things live in this project");
if (map.parts.some((p) => p.id === "site")) errors.push(`part id "site" is reserved for Whole site`);

// --- wiring: the tool folder, and for Vite the config that loads it
for (const f of ["server/core.ts", "server/slices.ts", "server/adapters.ts", htmlSite ? "server/serve.ts" : "server/vite-plugin.ts", "panel/inspector.js", "panel/inspector.css"]) {
  if (!existsSync(join(dir, ".inspector", "tool", f))) errors.push(`uberdesigner studio isn't installed: .inspector/tool/${f} is missing (run apply)`);
}
if (!htmlSite) {
  const vc = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find((f) => existsSync(join(dir, f)));
  if (!vc || !read(dir, vc).includes(".inspector/tool/server/vite-plugin.ts")) errors.push("the vite config doesn't load uberdesigner studio (run apply)");
}
if (existsSync(join(dir, "src/inspector/parts.ts")) || existsSync(join(dir, "vite.inspector.ts"))) warnings.push("leftovers of the old layout (src/inspector/, vite.inspector.ts): run apply to remove them");
if (!existsSync(join(dir, ".gitignore")) || !read(dir, ".gitignore").includes(".inspector")) warnings.push(".inspector/ (history, work files) isn't in .gitignore");

const outlined = map.parts.filter((p) => p.outline !== false && !waiting.includes(p.id)).length;
ok.push(`${map.parts.length - waiting.length} parts (${outlined} outlined), ${described.size} tokens described, ${map.facts?.length ?? 0} facts`);
if (waiting.length) ok.push(`${waiting.length} layer${waiting.length > 1 ? "s" : ""} waiting for Undo or History (removed in the studio, or added by an undone change): ${waiting.join(", ")}`);
if (sentSizes.length) {
  const sorted = [...sentSizes].sort((x, y) => x - y);
  ok.push(`a part's change sends ~${(sorted[Math.floor(sorted.length / 2)] / 3600).toFixed(1)}k tokens of code (median; largest ~${(sorted[sorted.length - 1] / 3600).toFixed(1)}k)`);
} else if (!slices) warnings.push("couldn't load the runtime's context picker (Node 23.6+ needed), so request sizes weren't measured");

// --- check: the project typecheck, or for HTML sites a parse of the inline scripts
if (!args.includes("--no-typecheck") && htmlSite) {
  const bad = [];
  for (const f of src.filter((f) => isMarkup(f) || /\.m?js$/.test(f))) {
    // The same rule as the check after a change (script-check.ts): a .js file with import or export is a module
    for (const sc of scriptsIn(f, read(dir, f))) {
      const r = spawnSync(process.execPath, [...(sc.module ? ["--input-type=module"] : []), "--check", "-"], { input: sc.code, encoding: "utf8" });
      if (r.status !== 0) bad.push(`${sc.name}: ${(r.stderr.split("\n").find((l) => /Error/.test(l)) ?? "").trim()}`);
    }
  }
  if (bad.length) errors.push(`scripts don't parse:\n${bad.join("\n")}`);
  else ok.push("scripts parse");
}
if (!args.includes("--no-typecheck") && !htmlSite) {
  const tsc = join(dir, "node_modules/.bin/tsc");
  // A root tsconfig made only of references (create-vite's: files: [] + references) checks nothing with -p: build the
  // referenced projects instead, as the project's own build does (tsc -b)
  const root = (() => {
    try {
      return JSON.parse(read(dir, "tsconfig.json").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      return null;
    }
  })();
  const solution = !!root?.references?.length && (Array.isArray(root.files) && !root.files.length) && !root.include;
  const r = spawnSync(tsc, solution ? ["-b"] : ["--noEmit", "-p", "."], { cwd: dir, encoding: "utf8" });
  if (r.status === 0) ok.push("typecheck passes");
  else if (r.error) warnings.push(`couldn't run the typecheck (${r.error.code === "ENOENT" ? "no TypeScript in node_modules" : r.error.message})`);
  else errors.push(`typecheck fails:\n${`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(0, 12).join("\n")}`);

}

// --- phone copies: a site that shows a separate element on phones (.m-script next to .script, .x-mobile, .mobile-x)
// needs both tagged under the same part, or a change reaches one layout only (and Before/After shows no difference
// at the other width)
for (const f of src.filter(isMarkup)) {
  const text = read(dir, f);
  const tags = [...text.matchAll(/<[a-zA-Z][\w-]*\b[^>]*>/g)].map((m) => m[0]);
  const classesOf = (t) => (t.match(/\bclass\s*=\s*["']([^"']*)["']/)?.[1] ?? "").split(/\s+/).filter(Boolean);
  const partOf = (t) => t.match(new RegExp(`\\b${TAG}\\s*=\\s*["']([^"']+)["']`))?.[1] ?? null;
  const tagged = new Map(); // class -> part
  for (const t of tags) {
    const part = partOf(t);
    if (part) for (const c of classesOf(t)) tagged.set(c, part);
  }
  for (const t of tags) {
    if (partOf(t)) continue;
    for (const c of classesOf(t)) {
      const base = c.replace(/^(m|mobile|phone)-/, "").replace(/-(m|mobile|phone)$/, "");
      if (base === c) continue;
      const part = tagged.get(base) ?? [...tagged.entries()].find(([k]) => k.startsWith(base))?.[1];
      if (part) warnings.push(`${part}: the phone copy .${c} in ${f} isn't tagged, so changes reach the desktop element only: add a target for it to the same part`);
    }
  }
}

// --- Claude Code on this computer: the inspector's changes run the `claude` command from the dev server. Setup checks
// it first, in the chat (step 0, setup-check.sh); this is the backstop for a setup that put it off.
const person = [];
{
  const c = claudeCode();
  if (c.state === "missing") person.push(`Claude Code isn't installed as a terminal command, and uberdesigner studio needs it to make changes (Claude Code in the desktop app or an IDE doesn't add it). Offer to connect it now, as in step 0 of SKILL.md (explain; they run the command)`);
  else if (c.state === "old") person.push(`Claude Code ${c.version} is too old to report its sign-in: offer to connect it now, as in step 0 of SKILL.md`);
  else if (c.state === "signed-out") person.push(`Claude Code ${c.version} is installed but not signed in, so uberdesigner studio can't make changes yet. Offer to connect it now, as in step 0 of SKILL.md`);
  else if (c.apiKey) ok.push(`Claude Code ${c.version} found; ANTHROPIC_API_KEY is set (the dev server must be started with it too)`);
  else {
    ok.push(`Claude Code ${c.version} installed and signed in with ${c.how}: uberdesigner studio can make changes`);
    if (c.days < 7) person.push(`Claude Code's sign-in runs out in ${Math.max(0, Math.round(c.days))} day(s): offer to sign in again, as in step 0 of SKILL.md`);
  }
}

const print = (label, list) => list.forEach((l) => console.log(`${label} ${l}`));
print("ok   ", ok);
print("warn ", warnings);
print("ERROR", errors);
print("TELL ", person);
console.log(
  errors.length
    ? `\n${errors.length} error(s): fix the map or the code and run verify again.`
    : (person.length ? "\nTELL lines are for the person, not the map: offer to connect Claude Code now, as in step 0 of SKILL.md.\n" : "") +
      "\nThe map is consistent with the code. Last step: open the site, press I and check that every outlined part frames what its label names (a layer marked \"not on page\" has a tag or an address the page doesn't answer: pick it and the editor says why).",
);
process.exit(errors.length ? 1 : 0);
