#!/usr/bin/env node
// design-map step 4: apply a map to the project. No tokens spent.
//   node apply.mjs <project> <map.json> [--dry-run] [--rename-old-tags]
// 1. Tags each part's elements with data-dm="<id>", the inspector's own attribute: every target { file, find } names
//    one JSX or HTML element by a piece of its opening tag (e.g. "className={styles.links}"); the script finds that
//    element (the TypeScript parser for JSX) and adds the attribute. A target must match exactly one element (add
//    "nth" to pick among several). A component (<SplitTitle …>) is refused unless the target says "forwards": true
//    (the component passes the tag on to its element; otherwise nothing on the page would carry it). A target
//    { selector } is an address asked of the page instead (for what the code can't tag): nothing is written for it.
//    Tags the map no longer asks for are removed. The site's own attributes (a data-part its script reads, say) are
//    never touched, and an element that has one can still be a layer. A map from before the inspector had its own
//    attribute (its tags were data-part) is renamed once, see 1a below.
// 2. Installs the inspector in .inspector/tool/ (server modules and the built panel, the same for every stack); for
//    Vite, a loader in vite.config that uses it when it's there; .inspector/ in .gitignore. Removes the earlier layout
//    (src/inspector/, vite.inspector.ts, the entry file's mount line) if present.
// 3. Writes inspector.map.json. Running it again is safe: what's already in place is left alone.
// A stack the inspector can't be set up on yet (Next.js, Astro, Vite without React…) is refused before anything else,
// and nothing is written until every check has passed: a mistake in the map leaves the site exactly as it was.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, htmlTags, isHtmlSite, loadTypeScript, projectDir, requireSupported, sourceFiles } from "./lib.mjs";
import { OLD_TAG, TAG, anchorsOf, selectorProblem } from "../runtime/server/address.ts";

const args = process.argv.slice(2);
const [dirArg, mapArg] = args.filter((a) => !a.startsWith("--"));
const dry = args.includes("--dry-run");
const dir = projectDir(dirArg);
requireSupported(dir);
if (!mapArg || !existsSync(mapArg)) fail("pass the map: node apply.mjs <project> <map.json>");
const map = JSON.parse(readFileSync(mapArg, "utf8"));
const htmlSite = isHtmlSite(dir);
const ts = sourceFiles(dir).some((f) => /\.(tsx|jsx)$/.test(f)) ? loadTypeScript(dir) : null;
const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime");
const done = [];
const notes = [];
// Nothing is written until every check below has passed: file texts wait in `pending` and other steps (installing the
// tool folder, removing the earlier layout) in `steps`, and both run at the very end. A map with a mistake in it, or a
// site apply can't wire, leaves the site exactly as it was.
const pending = new Map(); // site-relative path -> its new text
const steps = [];
const write = (rel, text) => pending.set(rel, text);
const current = (rel) => pending.get(rel) ?? readFileSync(join(dir, rel), "utf8");

// --- 0. the map's shape
if (map.version !== 1 || !Array.isArray(map.parts) || !Array.isArray(map.groups)) fail("map needs version 1, groups and parts");
const ids = new Set();
for (const p of map.parts) {
  if (!/^[a-z][a-z0-9-]*$/.test(p.id ?? "")) fail(`part id "${p.id}" must be lowercase-with-dashes`);
  if (p.id === "site") fail(`part id "site" is reserved: the studio adds "Whole site" itself`);
  if (ids.has(p.id)) fail(`part id "${p.id}" is used twice`);
  ids.add(p.id);
  if (!map.groups.includes(p.group)) fail(`part "${p.id}" is in group "${p.group}", which isn't in groups`);
  for (const k of ["label", "prompt", "tokens", "files", "edit"]) if (p[k] === undefined) fail(`part "${p.id}" has no ${k}`);
}
// A target is a tag in the code ({ file, find }) or a selector asked of the page ({ selector }), never both
const isSelector = (t) => typeof t?.selector === "string";
const tagTargets = (p) => (p.targets ?? []).filter((t) => !isSelector(t));
for (const p of map.parts) {
  for (const t of p.targets ?? []) {
    if (isSelector(t)) {
      if (t.file !== undefined || t.find !== undefined) fail(`part "${p.id}": a target is either a tag in the code ({ "file", "find" }) or a selector ({ "selector" }), not both`);
      const why = selectorProblem(t.selector);
      if (why) fail(`part "${p.id}": its selector "${t.selector}" can't be used: ${why}`);
      for (const around of anchorsOf(t.selector)) {
        const holder = map.parts.find((q) => q.id === around);
        if (around === p.id) fail(`part "${p.id}": its selector starts from its own tag. Start it from the tagged part it sits in: [${TAG}='<that part>'] …`);
        if (!holder) fail(`part "${p.id}": its selector starts from [${TAG}='${around}'], and "${around}" isn't a part of the map`);
        if ((holder.targets ?? []).length && !tagTargets(holder).length) fail(`part "${p.id}": its selector starts from "${around}", which is itself found by a selector. Start it from a part that is tagged in the code`);
      }
    } else if (typeof t?.file !== "string" || typeof t?.find !== "string" || !t.find) {
      fail(`part "${p.id}": a target needs "file" and "find" (a tag in the code), or "selector" (an address asked of the page)`);
    }
  }
}

// --- 1. the tags: data-dm="<id>" on each tag target's element
const byFile = new Map();
// A layer removed in the inspector keeps its map entry (so Undo can bring it back) but asks for no tag; if its tag is
// back in the code (an Undo), it's left alone
for (const p of map.parts) if (!p.removed) for (const t of tagTargets(p)) byFile.set(t.file, [...(byFile.get(t.file) ?? []), { ...t, id: p.id }]);
// Parts whose tags apply owns: the ones with tag targets (their tag belongs on those elements and nowhere else), and
// the ones found by a selector only (no element should carry their tag at all)
const managed = new Set(map.parts.filter((p) => (p.targets ?? []).length && !p.removed).map((p) => p.id));
const known = new Set(map.parts.map((p) => p.id));
// The attribute is the inspector's own, so every data-dm in the code is one it wrote (or Claude did, for a part a
// change added): one the map no longer asks for is removed. The site's own attributes are never read or touched.
const stale = (value) => !known.has(value) || managed.has(value);
const attrRe = (attr, lead = "\\s+") => new RegExp(`${lead}${attr}\\s*=\\s*("[^"]*"|'[^']*'|\\{[^}]*\\}|[^\\s>]+)`);
// The opening tag without its tag, so a target's find keeps matching after the tag is added ("<nav>"). On a map from
// before the rename the old tag is left out too, as the apply that wrote that map's finds did.
const untagged = (source) => (legacy ? source.replace(attrRe(OLD_TAG), "") : source).replace(attrRe(TAG), "");
// Once tagged, the tag is the truth. When as many elements carry a part's tag as the part has targets in the file,
// those elements are the part: a change may have rewritten one so its find no longer matches, or matches another
// element, and a find with "nth" counts differently once other elements around it are tagged.
const groupById = (targets) => {
  const by = new Map();
  for (const t of targets) by.set(t.id, [...(by.get(t.id) ?? []), t]);
  return [...by];
};

// Every target must be in a file apply reads and can tag; one in a file it never opens used to be skipped in silence
const walked = new Set(sourceFiles(dir));
for (const [file, targets] of byFile) {
  const who = [...new Set(targets.map((t) => t.id))].join(", ");
  if (!existsSync(join(dir, file))) fail(`${file}, the target file of ${who}, doesn't exist. Nothing was changed.`);
  if (!/\.(tsx|jsx|html?)$/.test(file)) fail(`${file}, the target file of ${who}, can't carry a tag: targets go on elements in .tsx, .jsx or .html files. Nothing was changed.`);
  if (!walked.has(file)) fail(`${file}, the target file of ${who}, isn't one of the files apply reads${htmlSite ? "" : " (in a Vite project: the files under src/)"}. Nothing was changed.`);
}

// --- 1a. a map from before the inspector had its own attribute: its tags were data-part="<id>". They're renamed once.
// Which data-part values were the inspector's: the ids of this map and of the installed one (the same rule the older
// apply used). If nothing else in the site's code says data-part, the old tags and every [data-part="<id>"] selector
// for those ids (the inspector's saved layer values, rules Claude wrote) are renamed. If the site uses data-part
// itself (its own attributes, a script that reads them), nothing of it is renamed: the new tag is added next to the
// old one, and only the inspector's own saved rules in the tokens file move to the new name.
const installed = (() => {
  try {
    return JSON.parse(readFileSync(join(dir, "inspector.map.json"), "utf8"));
  } catch {
    return null;
  }
})();
// --rename-old-tags does it again on a map already renamed: for a site whose files came back from before the rename
// (a History version that old was restored; the map isn't part of History, so it can't tell by itself)
const legacy = (!!installed && installed.tag !== TAG) || args.includes("--rename-old-tags");
const ours = new Set([...known, ...(installed?.parts ?? []).map((p) => p.id)]);
let keepOld = false; // the site uses data-part itself: old tags stay, new ones go next to them
if (legacy) {
  const idAlt = [...ours].map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "(?!)";
  const oldTag = new RegExp(`${OLD_TAG}=(?:"(?:${idAlt})"|'(?:${idAlt})'|\\{\\s*["'\`](?:${idAlt})["'\`]\\s*\\})`, "g");
  const texts = [...new Set([...sourceFiles(dir), ...(map.tokensFile && existsSync(join(dir, map.tokensFile)) ? [map.tokensFile] : [])])].filter((f) => /\.(html?|css|m?[jt]sx?)$/.test(f));
  keepOld = texts.some((f) => readFileSync(join(dir, f), "utf8").replace(oldTag, "").includes(OLD_TAG));
  let renamed = 0;
  for (const f of texts) {
    const text = readFileSync(join(dir, f), "utf8");
    if (!text.includes(OLD_TAG)) continue;
    // The site uses data-part too: only the rules the inspector itself saved (a rule that starts with the tag alone)
    const next = keepOld
      ? f === map.tokensFile
        ? text.replace(new RegExp(`((?:^|[{};/])\\s*)\\[${OLD_TAG}="(${idAlt})"\\](\\s*\\{)`, "g"), (_m, a, id, b) => `${a}[${TAG}="${id}"]${b}`)
        : text
      : text.replace(oldTag, (m) => TAG + m.slice(OLD_TAG.length));
    if (next === text) continue;
    renamed += (text.match(oldTag) ?? []).length;
    write(f, next);
  }
  if (keepOld) notes.push(`this map's tags were ${OLD_TAG}; the site's own code uses ${OLD_TAG} too, so the old tags were left in place and ${TAG} added next to them`);
  else if (renamed) done.push(`renamed ${renamed} old ${OLD_TAG} tag${renamed > 1 ? "s" : ""} and selector${renamed > 1 ? "s" : ""} to ${TAG}`);
}
// An element still carrying only the old tag of a part (kept because the site uses data-part): where that part is
const oldValue = (source) => (keepOld ? (source.match(attrRe(OLD_TAG, "\\s"))?.[1] ?? "").replace(/^[{\s]*["'`]?|["'`]?[\s}]*$/g, "") : "");
const carriesOld = (source, id) => keepOld && ours.has(id) && oldValue(source) === id;

const parse = (file, text) => {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const opens = [];
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) opens.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { sf, opens };
};
const tagOf = (sf, open) => open.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === TAG);
const valueOf = (sf, attr) => attr?.initializer?.getText(sf).replace(/^\{?\s*["'`]|["'`]\s*\}?$/g, "");
const ALREADY = (want, value) => `already has ${TAG}="${value}", the tag of part "${value}". An element carries one part: target the element around it or inside it, or give "${want}" a selector address`;

for (const file of sourceFiles(dir).filter((f) => /\.(tsx|jsx)$/.test(f) && ts)) {
  const text = current(file);
  const targets = byFile.get(file) ?? [];
  if (!targets.length && !text.includes(`${TAG}=`) && !(keepOld && text.includes(`${OLD_TAG}=`))) continue;
  const { sf, opens } = parse(file, text);
  const edits = []; // { from, to, text }
  const wanted = new Map(); // open element -> id
  const placed = []; // { hit, t }
  for (const [id, list] of groupById(targets)) {
    const carrying = opens.filter((o) => valueOf(sf, tagOf(sf, o)) === id || (!tagOf(sf, o) && carriesOld(o.getText(sf), id)));
    if (carrying.length === list.length) {
      carrying.forEach((hit, i) => placed.push({ hit, t: list[i] }));
      continue;
    }
    for (const t of list) {
      let hits = opens.filter((o) => untagged(o.getText(sf)).includes(t.find));
      if (carrying.length === 1 && (hits.length !== 1 || hits[0] !== carrying[0])) hits = t.nth === undefined ? carrying : hits;
      const hit = hits.length === 1 && t.nth === undefined ? hits[0] : t.nth !== undefined ? hits[t.nth] : null;
      if (!hit) fail(`${file}: "${t.find}" matches ${hits.length} elements for part "${t.id}" (needs exactly one, or set "nth")`);
      placed.push({ hit, t });
    }
  }
  for (const { hit, t } of placed) {
    const tag = hit.tagName.getText(sf);
    if ((/^[A-Z]/.test(tag) || tag.includes(".")) && !t.forwards) {
      fail(
        `${file}: the target for "${t.id}" is a component (<${tag}>), and a tag on a component only reaches the page if the component passes it on. ` +
          `Give the part a selector address instead ({ "selector": "[${TAG}='<the tagged part around it>'] <the element it renders>" }), tag the element it renders, ` +
          `or add "forwards": true if you checked that <${tag}> passes ${TAG} on`,
      );
    }
    if (wanted.has(hit)) fail(`${file}: parts "${wanted.get(hit)}" and "${t.id}" target the same element; an element can carry one part`);
    wanted.set(hit, t.id);
  }
  for (const open of opens) {
    const attr = tagOf(sf, open);
    const value = valueOf(sf, attr);
    const want = wanted.get(open);
    if (want && value === want) continue;
    if (want && attr && value !== want) {
      // The tag of a part that's gone, or that apply places elsewhere (a part split or renamed): re-tag it
      if (value && stale(value)) {
        edits.push({ from: attr.getStart(), to: attr.getEnd(), text: `${TAG}="${want}"`, note: `re-tagged ${value} as ${want}` });
        continue;
      }
      fail(`${file}: the element for "${want}" ${ALREADY(want, value)}`);
    }
    if (want) {
      edits.push({ from: open.tagName.getEnd(), to: open.tagName.getEnd(), text: ` ${TAG}="${want}"`, note: `tagged ${want}` });
      continue;
    }
    // a tag no target asks for: drop it if it's stale (its part is gone, or apply places that part elsewhere)
    if (attr && value && stale(value)) {
      const start = attr.getFullStart();
      edits.push({ from: start, to: attr.getEnd(), text: "", note: `removed stale ${TAG}="${value}"` });
      continue;
    }
    // A part a change added (no targets), still under its old tag only: the new one goes next to it
    const old = !attr ? oldValue(open.getText(sf)) : "";
    if (old && ours.has(old) && known.has(old) && !managed.has(old)) edits.push({ from: open.tagName.getEnd(), to: open.tagName.getEnd(), text: ` ${TAG}="${old}"`, note: `tagged ${old}` });
  }
  if (!edits.length) continue;
  let next = text;
  for (const e of edits.sort((x, y) => y.from - x.from)) next = next.slice(0, e.from) + e.text + next.slice(e.to);
  write(file, next);
  done.push(`${file}: ${edits.map((e) => e.note).join(", ")}`);
}

// Plain HTML: the same, on opening tags in the markup (not inside scripts, styles or comments)
for (const file of sourceFiles(dir).filter((f) => /\.html?$/.test(f))) {
  const text = current(file);
  const targets = byFile.get(file) ?? [];
  if (!targets.length && !text.includes(`${TAG}=`) && !(keepOld && text.includes(`${OLD_TAG}=`))) continue;
  const tags = htmlTags(text);
  const edits = [];
  const wanted = new Map(); // tag start -> id
  const placed = []; // { hit, t }
  for (const [id, list] of groupById(targets)) {
    const carrying = tags.filter((g) => g.attrs[TAG] === id || (g.attrs[TAG] === undefined && carriesOld(g.source, id)));
    if (carrying.length === list.length) {
      carrying.forEach((hit, i) => placed.push({ hit, t: list[i] }));
      continue;
    }
    for (const t of list) {
      let hits = tags.filter((g) => untagged(g.source).includes(t.find));
      if (carrying.length === 1 && t.nth === undefined) hits = carrying;
      const hit = hits.length === 1 && t.nth === undefined ? hits[0] : t.nth !== undefined ? hits[t.nth] : null;
      if (!hit) fail(`${file}: "${t.find}" matches ${hits.length} elements for part "${t.id}" (needs exactly one, or set "nth")`);
      placed.push({ hit, t });
    }
  }
  for (const { hit, t } of placed) {
    if (wanted.has(hit.start)) fail(`${file}: parts "${wanted.get(hit.start)}" and "${t.id}" target the same element; an element can carry one part`);
    wanted.set(hit.start, t.id);
  }
  for (const g of tags) {
    const value = g.attrs[TAG];
    const want = wanted.get(g.start);
    if (want && value === want) continue;
    if (want && value !== undefined && value !== want) {
      const m = g.source.match(attrRe(TAG, ""));
      if (m && stale(value)) {
        edits.push({ from: g.start + m.index, to: g.start + m.index + m[0].length, text: `${TAG}="${want}"`, note: `re-tagged ${value} as ${want}` });
        continue;
      }
      fail(`${file}: the element for "${want}" ${ALREADY(want, value)}`);
    }
    if (want) {
      edits.push({ from: g.nameEnd, to: g.nameEnd, text: ` ${TAG}="${want}"`, note: `tagged ${want}` });
      continue;
    }
    if (value && stale(value)) {
      const m = g.source.match(attrRe(TAG));
      if (m) edits.push({ from: g.start + m.index, to: g.start + m.index + m[0].length, text: "", note: `removed stale ${TAG}="${value}"` });
      continue;
    }
    const old = value === undefined ? oldValue(g.source) : "";
    if (old && ours.has(old) && known.has(old) && !managed.has(old)) edits.push({ from: g.nameEnd, to: g.nameEnd, text: ` ${TAG}="${old}"`, note: `tagged ${old}` });
  }
  if (!edits.length) continue;
  let next = text;
  for (const e of edits.sort((x, y) => y.from - x.from)) next = next.slice(0, e.from) + e.text + next.slice(e.to);
  write(file, next);
  done.push(`${file}: ${edits.map((e) => e.note).join(", ")}`);
}
const addressed = map.parts.filter((p) => !p.removed && (p.targets ?? []).some(isSelector));
if (addressed.length) done.push(`${addressed.length} part${addressed.length > 1 ? "s are" : " is"} found on the page by a selector (nothing written into the code): ${addressed.map((p) => p.id).join(", ")}`);

// --- 2. the inspector: one tool folder, the same for every stack (server modules + the built panel)
const tool = join(dir, ".inspector", "tool");
if (!existsSync(join(RUNTIME, "panel", "inspector.js"))) fail("the skill's runtime/panel/ isn't built (run pnpm build:panel in the skill folder)");
steps.push(() => {
  rmSync(tool, { recursive: true, force: true });
  for (const sub of ["server", "panel"]) {
    mkdirSync(join(tool, sub), { recursive: true });
    for (const f of readdirSync(join(RUNTIME, sub))) cpSync(join(RUNTIME, sub, f), join(tool, sub, f));
  }
  writeFileSync(join(tool, "VERSION"), `uberdesigner studio runtime, installed ${new Date().toISOString().slice(0, 10)}\n`);
  // the licence and the notice travel with every copy of the tool
  for (const f of ["LICENSE", "NOTICE.md"]) if (existsSync(join(RUNTIME, "..", f))) cpSync(join(RUNTIME, "..", f), join(tool, f));
});
done.push(`${dry ? "would install" : "installed"} uberdesigner studio in .inspector/tool/`);

// Leftovers of the earlier layout: panel source in src/inspector/, vite.inspector.ts, a mount line in the entry file
if (existsSync(join(dir, "src/inspector/Inspector.tsx")) && existsSync(join(dir, "src/inspector/parts.ts"))) {
  steps.push(() => rmSync(join(dir, "src/inspector"), { recursive: true, force: true }));
  done.push(`${dry ? "would remove" : "removed"} the old src/inspector/ (the panel is prebuilt now)`);
}
if (existsSync(join(dir, "vite.inspector.ts"))) {
  steps.push(() => rmSync(join(dir, "vite.inspector.ts")));
  done.push(`${dry ? "would remove" : "removed"} the old vite.inspector.ts`);
}
for (const f of ["src/main.tsx", "src/main.ts", "src/main.jsx"]) {
  if (!existsSync(join(dir, f))) continue;
  const text = current(f);
  const next = text.replace(/\n*\/\/ The design inspector[^\n]*\n[^\n]*inspector\/mount[^\n]*\n?/g, "\n").replace(/\n[^\n]*import\("\.\/inspector\/mount"\)[^\n]*/g, "");
  if (next !== text) {
    write(f, next.trimEnd() + "\n");
    done.push(`removed the old mount line from ${f}`);
  }
}

if (!htmlSite) {
  // Vite: the config loads the plugin from .inspector/tool/ only if it's there, so builds and fresh clones don't need it
  const viteConfig = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find((f) => existsSync(join(dir, f)));
  if (!viteConfig) fail("no vite.config found");
  let vc = readFileSync(join(dir, viteConfig), "utf8");
  const before = vc;
  vc = vc.replace(/\nimport \{ inspectorServer \} from "\.\/vite\.inspector(\.ts)?";/, "").replace(/,\s*inspectorServer\(\)|inspectorServer\(\),\s*/g, "");
  // An earlier version of the loader is replaced; a missing tool folder is fine, any other load error is reported
  vc = vc.replace(/\n*\/\/ The design inspector \(dev only\)[^\n]*\nconst inspector = await import\([\s\S]*?\n(?:  \}\);|  \.catch\(\(\) => null\);)\n/, "\n");
  const loader =
    `// The design inspector (dev only): loaded from .inspector/tool/ when it's there, so builds and fresh clones don't need it\n` +
    `const inspector = await import(/* @vite-ignore */ new URL("./.inspector/tool/server/vite-plugin.ts", import.meta.url).href)\n` +
    `  .then((m) => m.inspector())\n` +
    `  .catch((e) => {\n` +
    `    if (e?.code !== "ERR_MODULE_NOT_FOUND") console.warn("uberdesigner studio didn't load:", e?.message ?? e);\n` +
    `    return null;\n` +
    `  });\n`;
  const imports = [...vc.matchAll(/^import .+;$/gm)];
  const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
  vc = vc.slice(0, at).trimEnd() + "\n\n" + loader + "\n" + vc.slice(at).replace(/^\s+/, "");
  if (!/plugins:\s*\[/.test(vc)) fail(`${viteConfig} has no plugins: [ … ] to add uberdesigner studio to`);
  if (!/plugins:\s*\[[\s\S]*?\binspector\b[\s\S]*?\]/.test(vc))
    vc = vc.replace(/plugins:\s*\[([\s\S]*?)\]/, (_m, list) => `plugins: [${list.trim().replace(/,\s*$/, "")}${list.trim() ? ", " : ""}inspector]`);
  if (vc !== before) {
    write(viteConfig, vc);
    done.push(`${viteConfig} loads uberdesigner studio from .inspector/tool/`);
  }
}

const gitignore = join(dir, ".gitignore");
if (!existsSync(gitignore)) {
  write(".gitignore", "node_modules/\ndist/\n.inspector/\n");
  done.push("created .gitignore (node_modules, dist, .inspector)");
} else if (!readFileSync(gitignore, "utf8").includes(".inspector")) {
  write(".gitignore", `${readFileSync(gitignore, "utf8").trimEnd()}\n.inspector/\n`);
  done.push("added .inspector/ to .gitignore");
}

// --- 3. the map
map.tag = TAG; // the attribute this map's tags use (a map without it is from before 16 Nov 2026: data-part)
write("inspector.map.json", JSON.stringify(map, null, 2) + "\n");
done.push(`wrote inspector.map.json (${map.parts.length} parts in ${map.groups.length} groups)`);
// Every check has passed: now the site is changed
if (!dry) {
  for (const step of steps) step();
  for (const [rel, text] of pending) writeFileSync(join(dir, rel), text);
}
// The page files this map knows about, so the inspector can later tell which ones are new (its map check)
if (!dry) {
  const core = await import(new URL("../runtime/server/core.ts", import.meta.url).href).catch(() => null);
  if (core?.writeMapBaseline) {
    core.useRoot(dir);
    core.writeMapBaseline();
  }
}

console.log(`uberdesigner-studio apply${dry ? " (dry run, nothing written)" : ""}:\n${done.map((d) => `  - ${d}`).join("\n")}${notes.length ? `\n${notes.map((n) => `  ! ${n}`).join("\n")}` : ""}\nNext: node verify.mjs ${dirArg ?? "."}\nStart: ${htmlSite ? "node .inspector/tool/server/serve.ts" : "pnpm dev"} (then open the address it prints: the site opens in the studio)`);
