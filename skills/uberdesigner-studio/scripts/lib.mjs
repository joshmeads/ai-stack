// Shared helpers for the design-map scripts. No dependencies: TypeScript is borrowed from the project itself
// (every Vite + React + TS project has it), so JSX is read with a real parser.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
// One rule for what a plain HTML site is, shared with the inspector's server (Node 23.6+ runs the .ts file as is)
import { htmlEntry, siteServer, stackSupport } from "../runtime/server/adapters.ts";
import { tokenKind } from "../runtime/server/reconcile.ts";
import { markupOnly } from "../runtime/server/slices.ts";
export { htmlEntry, siteServer };

export function projectDir(arg) {
  const dir = resolve(arg ?? ".");
  if (!existsSync(join(dir, "package.json")) && !htmlEntry(dir)) fail(`No package.json or .html page in ${dir}: pass the site's folder`);
  return dir;
}

// Stops, before anything is read or written, on a site the inspector can't be set up on yet. Without this a Next.js
// site was indexed as "vite + react" with 0 files and exit 0, and apply installed half of the tool before stopping.
// DESIGN_MAP_FORCE=1 goes on anyway (for work on a new connector): the site is then treated as the closest stack.
export function requireSupported(dir) {
  const s = stackSupport(dir);
  if (s.ok) return s.adapter;
  const line = `Not supported yet: ${s.why}. uberdesigner studio works on Vite + React sites and on sites with no build step (HTML pages with their CSS and scripts).`;
  if (process.env.DESIGN_MAP_FORCE === "1") {
    console.warn(`uberdesigner-studio: ${line}\n  DESIGN_MAP_FORCE=1 is set, so going on as if it were supported. Expect gaps.`);
    return null;
  }
  fail(`${line}\nNothing was changed in ${dir}. Tell the person plainly that their stack (${s.found}) isn't supported yet; don't try to work around it.`);
}

// A site with no build step: HTML pages (one file with inline CSS and JS, or plain files, any page name), maybe sent by
// its own small server, and no build tool in a package.json
export const isHtmlSite = (dir) => htmlEntry(dir) !== null;

// The scripts' working files (index, prompt summary, draft map) live in the project's own .inspector/ folder, which
// the inspector's history already keeps out of git: one place per project, so parallel runs never collide.
export function workDir(dir) {
  const w = join(dir, ".inspector", "map-work");
  mkdirSync(w, { recursive: true });
  return w;
}

// TypeScript's compiler API (createSourceFile). TypeScript 7 (the Go port) has no JS API, so a project pinned to it
// can point the scripts at a TypeScript 5 elsewhere with DESIGN_MAP_TS=/path/to/node_modules/typescript.
// The skill's own TypeScript 5 is the fallback when the project's is 7: the one installed for it in .typescript/ (see
// the message below), else its dev dependency
const SKILL_DIR = resolve(new URL(".", import.meta.url).pathname, "..");
export function loadTypeScript(dir) {
  const candidates = [process.env.DESIGN_MAP_TS, join(dir, "package.json"), join(SKILL_DIR, ".typescript", "package.json"), join(SKILL_DIR, "package.json")].filter(Boolean);
  for (const from of candidates) {
    try {
      const ts = from.endsWith("package.json") ? createRequire(from)("typescript") : createRequire(join(from, "package.json"))(from);
      if (typeof ts?.createSourceFile === "function") return ts;
    } catch {
      /* try the next one */
    }
  }
  const pinned = (() => {
    try {
      return JSON.parse(readFileSync(join(dir, "node_modules/typescript/package.json"), "utf8")).version;
    } catch {
      return null;
    }
  })();
  fail(
    pinned?.startsWith("7")
      ? `The project uses TypeScript ${pinned} (new Vite projects do), which has no JS API for these scripts. Install ` +
          `TypeScript 5 for the skill once, then run this again:\n  npm install --prefix "${join(SKILL_DIR, ".typescript")}" typescript@5.9.3\n` +
          `(or point DESIGN_MAP_TS at any TypeScript 5 folder: DESIGN_MAP_TS=/path/to/node_modules/typescript)`
      : `No usable TypeScript in ${dir}. Run the project's install first (pnpm install / npm install), then run this again.`,
  );
}

export function fail(message) {
  console.error(`uberdesigner-studio: ${message}`);
  process.exit(1);
}

const SKIP = new Set(["node_modules", "dist", ".inspector", ".git", "inspector"]);

// Every source file, as project-relative paths: under src/ for a build-step project; for a plain HTML site, the
// site's own .html, .css, .js and .json files anywhere in it (the inspector's folder and packages left out)
export function sourceFiles(dir) {
  const html = isHtmlSite(dir);
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (!html || /\.(html?|css|m?js|json)$/.test(name)) out.push(relative(dir, abs));
    }
  };
  if (html) walk(dir);
  else if (existsSync(join(dir, "src"))) walk(join(dir, "src"));
  return out.filter((f) => f !== "inspector.map.json").sort();
}

// --- plain HTML

// The text with comments, and the contents of <script> and <style>, blanked out (same length, so offsets still match):
// the server's own (runtime/server/slices.ts)
export { markupOnly };

// Opening tags in the markup (not inside scripts, styles or comments), with where they are
export function htmlTags(html) {
  const masked = markupOnly(html);
  const tags = [];
  for (const m of masked.matchAll(/<([a-zA-Z][\w-]*)(\s[^<>]*?)?\/?>/g)) {
    const name = m[1].toLowerCase();
    if (["script", "style", "link", "meta", "html", "head", "br", "source"].includes(name)) continue;
    const start = m.index;
    const source = html.slice(start, start + m[0].length);
    const attrs = {};
    for (const a of source.matchAll(/\s([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) attrs[a[1]] = (a[2] ?? "").replace(/^["']|["']$/g, "");
    const after = masked.slice(start + m[0].length, start + m[0].length + 200);
    const text = after.split("<")[0].replace(/\s+/g, " ").trim();
    tags.push({ start, end: start + m[0].length, nameEnd: start + 1 + m[1].length, tag: name, source, attrs, text, line: html.slice(0, start).split("\n").length });
  }
  return tags;
}

// The CSS inside an HTML file's <style> blocks, and its inline scripts
export const styleText = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
export const scriptText = (html) => [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");

// The CSS of a file, whatever it is: a stylesheet as it is, an HTML file's <style> blocks
export const cssOf = (file, text) => (/\.html?$/.test(file) ? styleText(text) : text);

export const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");

// The :root blocks of a CSS file, with where each one is. "media" blocks sit inside an @media rule (phone overrides);
// the plain ones all apply, in order, so a later plain block overrides an earlier one (a template's "look" block).
export function rootBlocks(css) {
  const blocks = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length)); // keep offsets
  for (const m of clean.matchAll(/:root\s*\{([^}]*)\}/g)) {
    const before = clean.slice(0, m.index);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    const vars = Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
    blocks.push({ start: m.index, end: m.index + m[0].length, media: depth > 0, vars });
  }
  return blocks;
}

// Effective values: plain blocks merged in order (last wins), media blocks merged separately
export function tokenSets(css) {
  const blocks = rootBlocks(css);
  return {
    base: Object.assign({}, ...blocks.filter((b) => !b.media).map((b) => b.vars)),
    media: Object.assign({}, ...blocks.filter((b) => b.media).map((b) => b.vars)),
    plainBlocks: blocks.filter((b) => !b.media).length,
  };
}

// Back-compat: the list of blocks' vars, first block first
export const readRootBlocks = (css) => rootBlocks(css).map((b) => b.vars);

// What kind of value a token holds, as the server decides it (runtime/server/reconcile.ts)
export { tokenKind };

// --- Claude Code on this computer. The inspector's changes run the `claude` command from the dev server, on the
// person's own account; Claude Code in the desktop app or an IDE signs in on its own and doesn't put that command in
// the terminal. Checked the way the panel checks it (api.ts /__inspector/status), so no tokens are spent.
export const CLAUDE_INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";

// Where the inspector looks for it, in the same order as the server
export function claudeBin() {
  const candidates = [process.env.CLAUDE_BIN, join(homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? "claude";
}

// state: "ready" | "missing" (no terminal command) | "old" (can't report its sign-in) | "signed-out"
// how: who pays (Claude subscription, API billing, an API key); days: days until the sign-in runs out
export function claudeCode() {
  const bin = claudeBin();
  const version = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
  if (version.status !== 0) return { state: "missing", bin };
  const v = version.stdout.trim().split(" ")[0];
  if (process.env.ANTHROPIC_API_KEY) return { state: "ready", bin, version: v, how: "an API key (ANTHROPIC_API_KEY)", apiKey: true };
  let auth = null;
  try {
    auth = JSON.parse(spawnSync(bin, ["auth", "status", "--json"], { encoding: "utf8", timeout: 15000 }).stdout);
  } catch {
    /* an older Claude Code without auth status */
  }
  if (!auth) return { state: "old", bin, version: v };
  if (!auth.loggedIn) return { state: "signed-out", bin, version: v };
  const how = auth.authMethod === "claude.ai" ? "a Claude subscription" : "an Anthropic Console account (API billing)";
  const days = auth.loginExpiresAt ? (Date.parse(auth.loginExpiresAt) - Date.now()) / 86400000 : Infinity;
  return { state: "ready", bin, version: v, how, days };
}
