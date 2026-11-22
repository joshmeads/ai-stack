// The site the inspector is working on: where its folder is, which files may be edited, its map, a file as Claude
// sees it (embedded data swapped for placeholders), and the helpers for running a command or a package install in it.
// The other modules read these; only this one changes them (useRoot).

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { detectStack } from "./adapters.ts";

// The site's folder. This file lives in <site>/.inspector/tool/server/, so the site is three folders up; useRoot()
// can point it elsewhere.
export let ROOT = resolve(import.meta.dirname, "..", "..", "..");
export let STATE = join(ROOT, ".inspector");
export let GIT_DIR = join(STATE, "git");
export let HISTORY = join(STATE, "history.json");
export function useRoot(dir: string) {
  ROOT = resolve(dir);
  STATE = join(ROOT, ".inspector");
  GIT_DIR = join(STATE, "git");
  HISTORY = join(STATE, "history.json");
}
// The tool's own files: never part of the design's history, never touched by a restore
export const TOOL_PATHS = ["src/inspector/", "vite.inspector.ts", "vite.config.ts", "inspector.map.json"];
export const DESIGN = [".", ...TOOL_PATHS.map((p) => `:(exclude)${p}`)]; // git pathspec: everything but the tool
// Code, style and page files of the site (never the inspector's own folder or installed packages)
export const EDITABLE = /^(?!\.inspector\/|node_modules\/|dist\/)[\w./ -]+\.(tsx?|jsx?|mjs|css|json|html)$/;
export const hasTsconfig = () => detectStack(ROOT).check === "tsc" && (existsSync(join(ROOT, "tsconfig.json")) || existsSync(join(ROOT, "tsconfig.app.json")));
export const hasPackage = () => detectStack(ROOT).packages && existsSync(join(ROOT, "package.json"));

// Every editable file of the site, as site-relative paths
export function editableFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (["node_modules", "dist", ".inspector", ".git"].includes(name) || name.startsWith(".")) continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        const r = relative(ROOT, abs).replace(/\\/g, "/");
        if (EDITABLE.test(r) && r !== "inspector.map.json" && r !== "package.json" && !/lock|tsconfig|\.config\./.test(r)) out.push(r);
      }
    }
  };
  walk(ROOT);
  return out;
}

export type MapPart = { id: string; label: string; prompt: { where: string; text: string }[]; edit: string[]; tokens: string[]; note?: string; outline?: boolean; files?: string[]; targets?: unknown[] }; // targets: tags in the code, or selector addresses (address.ts)
export type DesignMap = {
  name?: string;
  source?: { prompt?: string | null } | null;
  facts?: string[];
  tokensFile?: string | null;
  content?: { file: string } | null;
  extraFiles?: string[];
  parts?: MapPart[];
};

export function readMap(): DesignMap {
  try {
    return JSON.parse(readFileSync(join(ROOT, "inspector.map.json"), "utf8")) as DesignMap;
  } catch {
    return {};
  }
}

// The map's facts, appended to the instructions of every request: where things live in this project
export function withFacts(system: string, heading: string): string {
  const facts = readMap().facts ?? [];
  return facts.length ? `${system}\n\n${heading}\n${facts.map((f) => `- ${f}`).join("\n")}` : system;
}

// The page is never reloaded behind the person's back: what can apply live does (styles, hot updates), and anything
// that needs a reload marks the page stale, so the panel offers a Reload button. vite-plugin.ts and serve.ts call this.
export let stale: { at: number; files: string[] } | null = null;
export function markStale(files: string[]) {
  const named = files.map((f) => f.replace(/^\/+/, "") || "the page");
  stale = { at: Date.now(), files: [...new Set([...(stale && Date.now() - stale.at < 60000 ? stale.files : []), ...named])].slice(-6) };
}

// What the inspector wrote on purpose (a finished request, an undo, a try put back, a restore, a comparison). On a
// stack whose dev server swaps changed modules into the open page, a stylesheet shows at once, but nothing tells
// whether code that was already running took the change: a loop a component started keeps the values it began with,
// though the dev server reports the update as done. So code written on purpose marks the page stale: the panel offers
// the reload after a request, and reloads at the click of an undo or a restore (jobs.ts). Pages served by serve.ts
// are judged file by file by its own watcher.
const STYLESHEET = /\.(css|scss|sass|less|styl|pcss)$/i;
export function wroteOnPurpose(files: string[]) {
  if (!detectStack(ROOT).hotUpdates) return;
  const code = files.filter((f) => !STYLESHEET.test(f) && f !== "inspector.map.json");
  if (code.length) markStale(code);
}

export function exec(
  bin: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeout?: number; onLine?: (line: string) => void; onSpawn?: (c: ChildProcess) => void } = {},
): Promise<{ code: number | null; out: string; err: string; timedOut: boolean }> {
  return new Promise((ok) => {
    const child = spawn(bin, args, { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env });
    opts.onSpawn?.(child);
    let out = "";
    let err = "";
    let pending = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeout ?? 15000);
    child.stdout.on("data", (c: Buffer) => {
      out += c;
      if (!opts.onLine) return;
      pending += c;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      lines.forEach((l) => l.trim() && opts.onLine?.(l));
    });
    child.stderr.on("data", (c: Buffer) => (err += c));
    child.on("error", (e) => {
      clearTimeout(timer);
      ok({ code: -1, out, err: e.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending.trim()) opts.onLine?.(pending);
      ok({ code, out, err, timedOut });
    });
    // A command that ends without reading what it was sent (git, which reads nothing; one that couldn't start) closes
    // its input first, and the write to it fails. That isn't a failure of its own: how the command ended is the
    // result. Unheard, the error would end the whole server.
    child.stdin.on("error", () => undefined);
    if (opts.input) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export function safePath(rel: string): string {
  const clean = normalize(rel).replace(/\\/g, "/");
  if (!EDITABLE.test(clean) || clean.includes("..")) throw new Error(`Not an editable file: ${rel}`);
  const abs = resolve(ROOT, clean);
  if (!abs.startsWith(ROOT) || !existsSync(abs)) throw new Error(`No such file: ${rel}`);
  return abs;
}

export const rel = (p: unknown) => (typeof p === "string" ? p.replace(ROOT + "/", "") : "");

// pnpm as the dev server was started with it (npm_execpath), else from the PATH
export function pnpm(args: string[]) {
  const execpath = process.env.npm_execpath;
  return execpath && /\.c?js$/.test(execpath)
    ? exec(process.execPath, [execpath, ...args], { timeout: 5 * 60 * 1000 })
    : exec("pnpm", args, { timeout: 5 * 60 * 1000 });
}

// Embedded data (base64 fonts and images in data: URIs) is useless to Claude and can be most of a single-file site,
// so files are sent with each data URI replaced by a short placeholder, and put back when the edits are applied.
export const DATA_URI = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g;
export const PLACEHOLDER = /data:…\[kept by the inspector #(\d+), (\d+) KB\]/g;
export const stripped = new Map<string, string[]>(); // file -> the data URIs, by placeholder number

export function strip(file: string, text: string): string {
  const kept: string[] = [];
  const out = text.replace(DATA_URI, (m) => {
    kept.push(m);
    return `data:…[kept by the inspector #${kept.length - 1}, ${Math.round(m.length / 1024)} KB]`;
  });
  stripped.set(file, kept);
  return out;
}

export function unstrip(file: string, text: string): string {
  const kept = stripped.get(file) ?? [];
  return text.replace(PLACEHOLDER, (m, n: string) => {
    const original = kept[Number(n)];
    if (original === undefined) throw new Error(`Claude's edit to ${file} refers to embedded data that doesn't exist (${m})`);
    return original;
  });
}

export const view = (f: string) => strip(f, readFileSync(join(ROOT, f), "utf8"));

export const readSite = (f: string) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : null);
