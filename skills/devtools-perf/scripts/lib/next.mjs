// `cdt next build|start`: the project's own next with source maps forced on
// and output redirected to .next/cdt-profile, through a preloaded hook that
// wraps Next's loadConfig in memory. Fails closed: if the redirect cannot be
// confirmed, cdt exits non-zero, and a build leaves the project's files as
// they were.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./util.mjs";

const NEXT_DIST = ".next/cdt-profile";
const MARK = "cdt-profile";

const read = (f) => (existsSync(f) && statSync(f).isFile() ? readFileSync(f) : null);
const sha = (f) => { const b = read(f); return b && createHash("sha256").update(b).digest("hex"); };
const same = (a, b) => (a === null || b === null ? a === b : a.equals(b));

function git(cwd, args) {
  const r = spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { maxBuffer: 256 << 20 });
  return r.status === 0 ? r.stdout : null;
}

// Paths (absolute) git reports as changed or untracked under dir, with their
// porcelain status. Everything under .next/ is left to the BUILD_ID check.
function gitStatus(dir, root) {
  const out = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", dir]);
  if (out === null) return null;
  const entries = new Map();
  const parts = out.toString("utf8").split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const code = e.slice(0, 2);
    const f = join(root, e.slice(3));
    if (code[0] === "R" || code[0] === "C") i++;
    if (!f.startsWith(join(dir, ".next") + sep)) entries.set(f, code);
  }
  return entries;
}

// Records what a build could change in the source tree, then undoes only
// the changes that point at cdt-profile (Next writing the redirected distDir
// into tsconfig or next-env.d.ts). Anything else changed during the build
// is reported, never overwritten: it may be the user's own edit.
function guardProject(dir) {
  const before = new Map();
  const remember = (f, buf) => { if (!before.has(f)) before.set(f, buf); };
  for (const f of ["tsconfig.json", "next-env.d.ts"]) remember(join(dir, f), read(join(dir, f)));
  const root = git(dir, ["rev-parse", "--show-toplevel"])?.toString().trim();
  const gitBefore = root ? gitStatus(dir, root) : null;
  for (const f of gitBefore?.keys() ?? []) remember(f, read(f));

  return (hookState) => {
    if (hookState?.tsconfigPath) remember(hookState.tsconfigPath, hookState.tsconfig === null ? null : Buffer.from(hookState.tsconfig, "base64"));
    // Files git newly reports were clean (their bytes are the index's) or
    // did not exist (untracked).
    for (const [f, code] of (gitBefore && gitStatus(dir, root)) ?? []) {
      if (before.has(f)) continue;
      if (code === "??") remember(f, null);
      else {
        const idx = git(root, ["show", `:${relative(root, f).split(sep).join("/")}`]);
        if (idx) remember(f, idx);
      }
    }
    const report = { restored: [], removed: [], left: [] };
    for (const [f, was] of before) {
      const now = read(f);
      if (same(now, was)) continue;
      if (!now?.includes(MARK)) { report.left.push(f); continue; }
      if (was) { writeFileSync(f, was); report.restored.push(f); }
      else { unlinkSync(f); report.removed.push(f); }
    }
    return report;
  };
}

// The hook patches Next's config module by text; refuse before running a
// Next whose module does not look like the one it knows.
function precheck(configJs, sub) {
  const src = readFileSync(configJs, "utf8");
  const buildIndex = join(dirname(dirname(configJs)), "build", "index.js");
  const known = /\nasync function loadConfig\(/.test(src) && /return loadConfig;/.test(src)
    && (sub !== "build" || (existsSync(buildIndex) && readFileSync(buildIndex, "utf8").includes('require("../server/config")')));
  if (!known) {
    throw new Error(`this Next version's config loader (${configJs}) is not one cdt recognises, so it cannot redirect the build safely. `
      + "Use next build && next start --inspect instead (browser function names stay minified).");
  }
}

function countFiles(dir, re) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true }).filter((f) => re.test(String(f))).length;
}

function readState(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export async function nextWithSourceMaps(opts, pos) {
  const [sub, ...extra] = pos;
  if (!["build", "start"].includes(sub)) throw new Error("usage: cdt next build|start [--dir app] [-- next args]");
  if (typeof module.registerHooks !== "function") throw new Error(`cdt next needs Node 22.15+ or 23.5+ (module.registerHooks); this is ${process.version}`);
  const dir = resolve(opts.dir ?? ".");
  const req = createRequire(join(dir, "package.json"));
  let bin, configJs;
  try {
    bin = req.resolve("next/dist/bin/next");
    configJs = realpathSync(req.resolve("next/dist/server/config.js"));
  } catch {
    throw new Error(`no next package resolvable from ${dir}; pass --dir <the app folder>`);
  }
  precheck(configJs, sub);
  const out = join(dir, NEXT_DIST);
  if (sub === "start" && !existsSync(join(out, "BUILD_ID"))) throw new Error(`no profiling build in ${out}; run "cdt next build${opts.dir ? ` --dir ${opts.dir}` : ""}" first`);

  const stateDir = mkdtempSync(join(tmpdir(), "cdt-next-"));
  const stateFile = join(stateDir, "state.json");
  const userBuildId = join(dir, ".next", "BUILD_ID");
  const userBuildBefore = sha(userBuildId);
  const finishGuard = sub === "build" ? guardProject(dir) : null;
  const started = Date.now();

  const hook = fileURLToPath(new URL("../next-sourcemaps-hook.cjs", import.meta.url));
  const args = [bin, sub, ...(sub === "start" && !extra.some((a) => a.startsWith("--inspect")) ? ["--inspect"] : []), ...extra];
  const env = {
    ...process.env,
    CDT_NEXT_DIST_DIR: NEXT_DIST,
    CDT_NEXT_CONFIG_JS: configJs,
    CDT_NEXT_STATE: stateFile,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(hook)}`.trim(),
  };
  const child = spawn(process.execPath, args, { cwd: dir, env, stdio: "inherit" });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const forward = (sig) => child.kill(sig);
  signals.forEach((s) => process.on(s, forward));
  let exited = false;
  const exit = new Promise((res) => child.on("exit", (c, sig) => { exited = true; res(c ?? (sig ? 1 : 0)); }));

  const problems = [];
  if (sub === "start") {
    // The server loads its config at startup. No confirmation means it is
    // not serving the profiling build, so stop it rather than measure the
    // wrong thing.
    for (let i = 0; i < 300 && !exited && !existsSync(stateFile); i++) await sleep(100);
    if (!exited && !existsSync(stateFile)) {
      problems.push("the hook did not confirm Next's config was patched within 30s, so the server was stopped");
      child.kill("SIGTERM");
    } else if (!exited) {
      console.log(`cdt: next start is serving ${out} with source maps (inspector: --inspect, default port 9229)`);
    }
  }
  const code = await exit;
  signals.forEach((s) => process.off(s, forward));
  const state = readState(stateFile);
  rmSync(stateDir, { recursive: true, force: true });

  if (finishGuard) {
    const r = finishGuard(state);
    const rel = (f) => relative(dir, f) || f;
    for (const f of r.restored) console.log(`cdt: restored ${rel(f)} (next build had pointed it at ${NEXT_DIST})`);
    for (const f of r.removed) console.log(`cdt: removed ${rel(f)} (next build created it for ${NEXT_DIST}; it did not exist before)`);
    if (r.left.length) console.log(`cdt: changed during the build but not by the redirect, left as is: ${r.left.map(rel).join(", ")}`);
  }
  if (sha(userBuildId) !== userBuildBefore) {
    problems.push(`your own build in ${join(dir, ".next")} changed (BUILD_ID differs), so the output redirect did not hold. Rebuild it with next build.`);
  }
  if (sub === "build" && code === 0) {
    if (!state) problems.push("the hook never patched Next's config");
    const id = join(out, "BUILD_ID");
    if (!existsSync(id) || statSync(id).mtimeMs < started - 1000) problems.push(`no fresh profiling build in ${out}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`cdt: ${p}`);
    process.exitCode = code || 1;
    return;
  }
  if (sub === "build" && code === 0) {
    const server = countFiles(join(out, "server"), /\.js\.map$/);
    const browser = countFiles(join(out, "static"), /\.js\.map$/);
    console.log(`cdt: profiling build in ${out}: ${server} server and ${browser} browser source maps; your .next and next.config untouched`);
    if (!server || !browser) console.log("cdt: some maps are missing; function names for that side will stay minified");
    console.log(`cdt: serve it with "cdt next start${opts.dir ? ` --dir ${opts.dir}` : ""}" (adds --inspect)`);
  }
  process.exitCode = code;
}
