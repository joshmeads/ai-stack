#!/usr/bin/env node
// design-map step 1: index the code. No tokens spent.
//   node index.mjs <project> [--out file] [--prompt file]   (default out: <project>/.inspector/map-work/index.json)
// A compact summary for the mapping step: files and sizes; the design tokens (every plain :root block merged, last
// wins; phone overrides apart); tokens the site's own code overrides at runtime (setProperty); every component's
// meaningful JSX elements (tag, classes, text, existing data-dm tag; components and elements created in code marked);
// which design tokens each CSS rule uses (local variables listed apart); and the files that hold the words. With a
// prompt file (--prompt, or a prompt.md in the project), also the prompt's section paths exactly as verify checks a
// quote's "where", so a map can be written without reading the prompt's summary.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cssOf, fail, htmlEntry, htmlTags, isHtmlSite, siteServer, loadTypeScript, projectDir, read, requireSupported, rootBlocks, scriptText, sourceFiles, tokenKind, tokenSets, workDir } from "./lib.mjs";

const args = process.argv.slice(2);
const dir = projectDir(args.find((a) => !a.startsWith("--") && !["--out", "--prompt"].includes(args[args.indexOf(a) - 1])));
requireSupported(dir);
const files = sourceFiles(dir);
// An index of nothing isn't a result: say where the scripts looked
if (!files.length) fail(`Found no source files in ${dir}: the scripts read src/ in a Vite + React project. Nothing was changed.`);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(workDir(dir), "index.json");
const html = isHtmlSite(dir);
const entry = html ? htmlEntry(dir) : null;
const server = html ? siteServer(dir) : null;
// TypeScript only when there are .ts/.tsx/.jsx files to parse (a plain HTML site needs none)
const ts = files.some((f) => /\.(tsx?|jsx)$/.test(f)) ? loadTypeScript(dir) : null;
const isMarkup = (f) => /\.html?$/.test(f);
const codeOf = (f) => (isMarkup(f) ? scriptText(read(dir, f)) : read(dir, f));
const clip = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const pkg = html ? { name: basename(dir) } : JSON.parse(read(dir, "package.json"));
const index = {
  project: pkg.name,
  kind: html
    ? `html (no build step${server ? `; its own server, ${server.label}, runs behind .inspector/tool/server/serve.ts` : ": served by .inspector/tool/server/serve.ts"}; first page ${entry})`
    : "vite + react",
  stack: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort(),
  readme: ["README.md", "readme.md"].find((f) => { try { read(dir, f); return true; } catch { return false; } }) ?? null,
  files: files.map((f) => ({ path: f, bytes: Buffer.byteLength(read(dir, f)) })),
  tokens: [],
  runtimeOverrides: [],
  components: [],
  css: [],
  wordFiles: [],
};

// --- design tokens: CSS files with a plain :root block
const defined = new Set();
for (const f of files.filter((f) => f.endsWith(".css") || isMarkup(f))) {
  const css = cssOf(f, read(dir, f));
  if (!rootBlocks(css).length) continue;
  const { base, media, plainBlocks } = tokenSets(css);
  Object.keys(base).forEach((n) => defined.add(n));
  index.tokens.push({
    file: f,
    ...(plainBlocks > 1 ? { note: `${plainBlocks} plain :root blocks: later ones override earlier ones (values below are the effective ones)` } : {}),
    vars: Object.entries(base).map(([name, value]) => ({ name, value: clip(value, 60), kind: tokenKind(value) })),
    ...(Object.keys(media).length ? { phone: Object.fromEntries(Object.entries(media).map(([k, v]) => [k, clip(v, 40)])) } : {}),
  });
}

// --- tokens the site's code sets at runtime (they win over the CSS file)
for (const f of files.filter((f) => /\.(tsx?|jsx?|m?js)$/.test(f) || isMarkup(f))) {
  const text = codeOf(f);
  text.split("\n").forEach((line, i) => {
    if (/setProperty\(/.test(line) && /(documentElement|document\.body|:root)/.test(line)) {
      index.runtimeOverrides.push({ file: f, line: i + 1, code: clip(line.trim(), 120) });
    }
  });
}

// --- CSS: which tokens each rule uses (class and element selectors); variables not defined as tokens are "local"
for (const f of files.filter((f) => f.endsWith(".css") || isMarkup(f))) {
  const css = cssOf(f, read(dir, f)).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = {};
  const local = new Set();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (selector.startsWith(":root") || selector.startsWith("@")) continue;
    const used = [...new Set([...rule[2].matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const set = [...rule[2].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    set.forEach((v) => local.add(v));
    const tokens = used.filter((v) => defined.has(v));
    if (!tokens.length) continue;
    const names = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    const keys = names.length ? names : [selector.split(/[\s,>:]/)[0]];
    for (const k of keys) rules[k] = [...new Set([...(rules[k] ?? []), ...tokens])];
  }
  const usedLocal = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => !defined.has(v));
  if (Object.keys(rules).length || usedLocal.length) {
    index.css.push({ file: f, rules, ...(usedLocal.length ? { localVars: [...new Set([...usedLocal, ...local])].filter((v) => !defined.has(v)) } : {}) });
  }
}

// --- components: meaningful JSX elements, plus elements created in code
const strings = {}; // file -> human-readable strings, for the words guess

// Plain HTML: the markup's meaningful elements, and elements its scripts create
for (const f of files.filter(isMarkup)) {
  const text = read(dir, f);
  const elements = [];
  const words = [];
  for (const t of htmlTags(text)) {
    const attrs = Object.fromEntries(
      Object.entries(t.attrs)
        .filter(([k]) => ["class", "id", "aria-label", "href", "role"].includes(k) || k.startsWith("data-"))
        .map(([k, v]) => [k, clip(v, 60)]),
    );
    if (t.text.split(" ").length >= 3) words.push(t.text);
    if (Object.keys(attrs).length || t.text) elements.push({ line: t.line, tag: t.tag, ...attrs, ...(t.text ? { text: clip(t.text) } : {}) });
  }
  const scripts = scriptText(text);
  const offset = text.split("\n").findIndex((l) => /<script\b(?![^>]*\bsrc=)/i.test(l));
  scripts.split("\n").forEach((line, i) => {
    const m = line.match(/createElement\(\s*(['"`][\w-]+['"`])|\.(innerHTML|insertAdjacentHTML)\b/);
    if (m) elements.push({ line: offset + 1 + i, tag: m[1] ?? m[2], createdInCode: true });
  });
  strings[f] = words;
  index.components.push({ file: f, exports: [], elements });
}

for (const f of files.filter((f) => /\.(tsx|jsx|ts|js)$/.test(f) && ts)) {
  const text = read(dir, f);
  const isJsx = /\.(tsx|jsx)$/.test(f);
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const exports = [];
  const elements = [];
  const words = [];
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name) exports.push(node.name.text);
      else node.declarationList?.declarations.forEach((d) => exports.push(d.name.getText(sf)));
    }
    // human-readable strings: 3+ words, not class names, not shader code, not inside JSX attributes
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent) && !ts.isImportDeclaration(node.parent)) {
      const s = node.text.trim();
      if (s.split(/\s+/).length >= 3 && /[a-z]{3}/i.test(s) && !/[{};]|\bvec[234]\b|gl_|uniform |cubic-bezier|var\(--|^[\w-]+( [\w-]+)*$/.test(s.slice(0, 200))) words.push(s);
      else if (s.split(/\s+/).length >= 3 && /^[A-Z][^{};]*[.!?…"”]?$/.test(s)) words.push(s);
    }
    if (ts.isCallExpression(node) && /createElement$/.test(node.expression.getText(sf)) && node.arguments[0]) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      elements.push({ line, tag: clip(node.arguments[0].getText(sf), 30), createdInCode: true });
    }
    if (isJsx && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = open.tagName.getText(sf);
      const attrs = {};
      for (const a of open.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const name = a.name.getText(sf);
        if (["className", "id", "aria-label", "href", "as"].includes(name) || name.startsWith("data-")) {
          attrs[name] = a.initializer ? clip(a.initializer.getText(sf).replace(/^\{|\}$/g, ""), 60) : "true";
        }
      }
      const text = ts.isJsxElement(node)
        ? node.children
            .filter((c) => (ts.isJsxText(c) && c.getText(sf).trim()) || (ts.isJsxExpression(c) && c.expression && !ts.isJsxElement(c.expression)))
            .map((c) => c.getText(sf).trim())
            .filter((t) => t && !/^\{\s*\/\*/.test(t))
            .join(" ")
        : "";
      const component = /^[A-Z]/.test(tag) || tag.includes(".");
      if (Object.keys(attrs).length || text || component) {
        const line = sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1;
        elements.push({ line, tag, ...(component ? { component: true } : {}), ...attrs, ...(text ? { text: clip(text.replace(/\s+/g, " ")) } : {}) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  strings[f] = words;
  if (isJsx || elements.length) index.components.push({ file: f, exports, elements });
}

// --- where the words live: files with many human-readable strings; content/copy/i18n files first
for (const [f, list] of Object.entries(strings)) {
  if (list.length < 4 && !/content|copy|i18n|strings|texts?\b/i.test(f)) continue;
  if (!list.length) continue;
  const score = list.length + (/content|copy|i18n|strings|texts?\b/i.test(f) ? 50 : 0) + (/\.json$/.test(f) ? 20 : 0);
  index.wordFiles.push({ file: f, strings: list.length, score, sample: list.slice(0, 4).map((s) => clip(s, 60)) });
}
for (const f of files.filter((f) => f.endsWith(".json"))) {
  try {
    const flat = JSON.stringify(JSON.parse(read(dir, f)));
    const n = (flat.match(/"[^"]*\s[^"]*\s[^"]*"/g) ?? []).length;
    if (n >= 3) index.wordFiles.push({ file: f, strings: n, score: n + 70, sample: [] });
  } catch {
    /* not JSON we can read */
  }
}
index.wordFiles.sort((a, b) => b.score - a.score);
index.wordFiles = index.wordFiles.slice(0, 5).map(({ score: _score, ...w }) => w);

// The prompt's section paths, as read-prompt (and so verify) names them
const promptArg = args.includes("--prompt") ? resolve(args[args.indexOf("--prompt") + 1]) : join(dir, "prompt.md");
if (existsSync(promptArg)) {
  const tmp = join(workDir(dir), "prompt-paths.json");
  const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "read-prompt.mjs"), promptArg, "--out", tmp], { encoding: "utf8" });
  if (r.status === 0) {
    const p = JSON.parse(readFileSync(tmp, "utf8"));
    index.prompt = { file: promptArg.startsWith(dir + "/") ? promptArg.slice(dir.length + 1) : promptArg, layout: p.layout, sections: p.sections.map((x) => x.path) };
  }
}

const json = JSON.stringify(index, null, 1);
writeFileSync(out, json + "\n");
const tokenCount = index.tokens.reduce((n, t) => n + t.vars.length, 0);
console.log(
  `uberdesigner-studio index: ${index.files.length} files, ${index.components.length} components, ${tokenCount} tokens` +
    `${index.runtimeOverrides.length ? `, ${index.runtimeOverrides.length} runtime token override(s)` : ""} → ${out} (~${Math.round(json.length / 3.6 / 1000)}k tokens to read)`,
);
