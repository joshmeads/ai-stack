#!/usr/bin/env node
// The before/after suite: the same checks on the same test sites with two versions of the inspector, and what
// differs. Run it before merging anything that touches the runtime or the scripts.
//
//   node tests/sites/run.mjs --sites tests/sites/sites.local.json [--only bakery,keycap]
//        [--base main] [--head .] [--checks layers,writes,size,coverage] [--out results.json] [--allow-differences]
//
// Exit code: 0 when the two versions behave the same; 1 when a check found a difference (a refactor must have none;
// for a change that is meant to behave differently, read the lines and pass --allow-differences); 2 when a check
// couldn't run.
//
// --base / --head: a git ref (built in a temporary worktree) or "." (this working tree, its panel rebuilt first).
// Each site is copied twice into a temporary folder (node_modules linked, the inspector's history left behind), each
// copy is set up by that version's own apply.mjs with the site's map (so its tags are the ones that version reads),
// its dev server starts with a stand-in Claude CLI (nothing is ever sent to Claude), and the
// checks run in headless Chrome:
//   coverage  how much of what is on screen can be picked, in one click or two   (coverage.mjs; not in the default set)
//   layers  every layer: jump, shown or not, the dashed box, what a click picks; fps; text editing   (layers.mjs)
//   writes  idle, a saved value, a text edit and its Undo, a motion value, Restore: files byte for byte   (writes.mjs)
//   size    what three part changes would send to Claude   (size.mjs)
// The sites file: [{ "name": "bakery", "dir": "/abs/path/to/site", "path": "/" (the page, when not /), "moving": true (a piece that plays on a loop) }, …] (Vite sites and no-build HTML sites with
// the inspector installed). The sites themselves are never touched; the copies stay in the temporary folder printed
// at the end. Needs Google Chrome (CHROME=… for another path) and pnpm for Vite sites.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "./cdp.mjs";
import coverage, { compareCoverage } from "./coverage.mjs";
import layers, { compareLayers } from "./layers.mjs";
import size, { compareSize } from "./size.mjs";
import writes, { compareWrites } from "./writes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const sitesFile = arg("sites");
if (!sitesFile) {
  console.error("usage: node tests/sites/run.mjs --sites <sites.json> [--only a,b] [--base main] [--head .] [--checks layers,writes,size] [--out results.json] [--allow-differences]");
  process.exit(1);
}
const only = arg("only")?.split(",");
// A site's folder may be given relative to the sites file (the fixture sites kept in the repo)
const SITES = JSON.parse(readFileSync(sitesFile, "utf8"))
  .filter((s) => !only || only.includes(s.name))
  .map((s) => ({ ...s, dir: resolve(dirname(resolve(sitesFile)), s.dir) }));
const BASE = arg("base", "main");
const HEAD = arg("head", ".");
const CHECKS = arg("checks", "layers,writes,size").split(",");
const OUT = arg("out");
const WORK = mkdtempSync(join(tmpdir(), "design-map-sites-"));
const FAKE = join(HERE, "fake-claude.mjs");
const worktrees = [];

// --- the two versions of the skill (each one's folder: runtime/ and scripts/)
function versionFor(ref, side) {
  if (ref === ".") {
    execFileSync("pnpm", ["-s", "build:panel"], { cwd: REPO, stdio: "ignore" });
    return REPO;
  }
  const dir = join(WORK, `runtime-${side}`);
  execFileSync("git", ["-C", REPO, "worktree", "add", "--detach", "--quiet", dir, ref]);
  worktrees.push(dir);
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  execFileSync("pnpm", ["-s", "build:panel"], { cwd: dir, stdio: "ignore" });
  return dir;
}

// --- a site's copy with one runtime
const LEAVE = new Set(["node_modules", "dist"]);
function copySite(src, dest, withInspector) {
  cpSync(src, dest, {
    recursive: true,
    filter: (path) => {
      const rel = relative(src, path);
      if (!rel) return true;
      if (LEAVE.has(rel.split(sep)[0])) return false;
      // The inspector's own state (history, cards, settings) stays behind: each copy starts fresh
      if (rel.startsWith(`.inspector${sep}`) && !(withInspector && rel.startsWith(join(".inspector", "tool")))) return false;
      return true;
    },
  });
  if (existsSync(join(src, "node_modules"))) symlinkSync(join(src, "node_modules"), join(dest, "node_modules"));
}
// Set the copy up as that version would: its apply.mjs with the site's own map (tags, the tool folder, the map). The
// two versions may tag differently (the inspector's attribute was data-part before 16 Nov 2026), so copying only the
// tool folder would leave the newer side with no layers. If apply stops, the tool folder alone is copied, and said.
function install(version, dest, name) {
  try {
    execFileSync(process.execPath, [join(version, "scripts", "apply.mjs"), dest, join(dest, "inspector.map.json")], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    return;
  } catch (err) {
    console.log(`${name}: apply stopped (${String(err.stderr ?? err.message).trim().split("\n")[0]}); only the tool folder was copied`);
  }
  for (const sub of ["server", "panel"]) {
    const to = join(dest, ".inspector", "tool", sub);
    if (existsSync(to)) rmSync(to, { recursive: true });
    cpSync(join(version, "runtime", sub), to, { recursive: true });
  }
}

// --- its dev server, with the stand-in Claude
const freePort = () =>
  new Promise((ok) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
async function startServer(dest, captureDir) {
  const port = await freePort();
  const env = { ...process.env, CLAUDE_BIN: FAKE, CAPTURE_DIR: captureDir };
  const vite = ["vite.config.ts", "vite.config.js", "vite.config.mjs"].some((f) => existsSync(join(dest, f)));
  const child = vite
    ? spawn("pnpm", ["exec", "vite", "--port", String(port), "--strictPort"], { cwd: dest, env, detached: true, stdio: "ignore" })
    : spawn(process.execPath, [".inspector/tool/server/serve.ts", "--port", String(port)], { cwd: dest, env, detached: true, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return { port, stop: () => process.kill(-child.pid) };
    } catch {
      /* starting */
    }
    await sleep(500);
  }
  process.kill(-child.pid);
  throw new Error(`the dev server for ${dest} didn't start`);
}

const RUN = { layers: (t, c) => layers(t, c.map), writes: (t, c) => writes(t, c), size: (t, c) => size(t, c), coverage: (t) => coverage(t) };
const COMPARE = { layers: compareLayers, writes: compareWrites, size: compareSize, coverage: compareCoverage };

const versions = { base: versionFor(BASE, "base"), head: versionFor(HEAD, "head") };
const results = {};
let differing = 0;
let broken = 0;
console.log(`design-map sites: ${BASE} → ${HEAD === "." ? "this working tree" : HEAD}, checks ${CHECKS.join(", ")}, ${SITES.length} site(s)\n`);
for (const site of SITES) {
  results[site.name] = {};
  for (const side of ["base", "head"]) {
    const dest = join(WORK, `${site.name}-${side}`);
    const snap = `${dest}.snap`;
    const captureDir = `${dest}.capture`;
    copySite(site.dir, dest, true);
    install(versions[side], dest, `${site.name} (${side})`);
    copySite(dest, snap, false);
    mkdirSync(captureDir, { recursive: true });
    const server = await startServer(dest, captureDir);
    const map = JSON.parse(readFileSync(join(dest, "inspector.map.json"), "utf8"));
    results[site.name][side] = {};
    for (const check of CHECKS) {
      const t = await openEditor(`http://localhost:${server.port}/__inspector/editor?path=${encodeURIComponent(site.path ?? "/")}`);
      try {
        results[site.name][side][check] = await RUN[check](t, { site: dest, snap, map, captureDir });
      } catch (err) {
        results[site.name][side][check] = { error: String(err.message) };
      } finally {
        t.close();
      }
    }
    server.stop();
  }
  for (const check of CHECKS) {
    const a = results[site.name].base[check];
    const b = results[site.name].head[check];
    if (a?.error || b?.error) {
      console.log(`${site.name} · ${check}: error ${a?.error ?? ""} ${b?.error ?? ""}`);
      broken++;
      continue;
    }
    const { summary, lines } = COMPARE[check](a, b, { moving: !!site.moving });
    console.log(`${site.name} · ${check}: ${summary}${lines.length ? "" : " · no differences"}`);
    for (const l of lines) console.log(`    ${l}`);
    if (lines.length) differing++;
  }
}
for (const dir of worktrees) execFileSync("git", ["-C", REPO, "worktree", "remove", "--force", dir]);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log(`\ncopies: ${WORK}`);
if (broken) console.log(`${broken} check(s) couldn't run`);
else if (differing) console.log(`${differing} check(s) differ between the two versions${process.argv.includes("--allow-differences") ? " (allowed)" : ""}`);
process.exit(broken ? 2 : differing && !process.argv.includes("--allow-differences") ? 1 : 0);
