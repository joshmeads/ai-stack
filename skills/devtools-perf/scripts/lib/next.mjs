// `cdt next build|start`: the project's own next with source maps forced on
// and output redirected to <distDir>/cdt-profile, through a preloaded hook
// that wraps Next's loadConfig in memory. Fails closed: if the redirect
// cannot be confirmed, cdt exits non-zero. A build leaves the project as it
// was: cdt undoes exactly the writes Next made to tsconfig and next-env.d.ts
// (lib/next-guard.cjs), and only reports anything else that changed.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import guard from "./next-guard.cjs";
import { sleep } from "./util.mjs";

const { MARK } = guard;
const HOOK = fileURLToPath(new URL("../next-sourcemaps-hook.cjs", import.meta.url));
const BUILD_INFO = "cdt-build.json";

const sha = (f) => { const b = guard.readOrNull(f); return b && createHash("sha256").update(b).digest("hex"); };
const inside = (f, d) => f === d || f.startsWith(d + sep);
const rel = (dir, f) => relative(dir, f) || f;

function git(cwd, args) {
  const r = spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { maxBuffer: 64 << 20 });
  if (r.error) return { error: r.error.message };
  if (r.status !== 0) return { error: r.stderr.toString().trim().split("\n")[0] };
  return { out: r.stdout.toString() };
}

// path -> "XY" status for what git reports under dir (paths only, never
// contents), or { error } when git cannot say.
function gitStatus(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (top.error) return top;
  const r = git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  if (r.error) return r;
  const entries = new Map();
  const parts = r.out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    if (e[0] === "R" || e[0] === "C") i++; // the rename's source follows
    entries.set(join(top.out.trim(), e.slice(3)), e.slice(0, 2));
  }
  return { entries };
}

// The hook patches Next by text; refuse before running a Next whose config
// loader or entry modules do not look like the ones it knows.
function resolveNext(dir, sub) {
  const req = createRequire(join(dir, "package.json"));
  let bin, configJs;
  try {
    bin = req.resolve("next/dist/bin/next");
    configJs = realpathSync(req.resolve("next/dist/server/config.js"));
  } catch {
    throw new Error(`no next package resolvable from ${dir}; pass --dir <the app folder>`);
  }
  const dist = dirname(dirname(configJs));
  const src = readFileSync(configJs, "utf8");
  const entries = sub === "build" ? ["cli/next-build.js", "build/index.js"] : ["cli/next-start.js"];
  const known = /\nasync function loadConfig\(/.test(src) && /return loadConfig;/.test(src)
    && entries.every((e) => existsSync(join(dist, e)))
    && (sub !== "build" || readFileSync(join(dist, "build", "index.js"), "utf8").includes('require("../server/config")'));
  if (!known) {
    throw new Error(`this Next version (${dist}) is not one cdt recognises, so it cannot redirect the build safely. `
      + "Use next build && next start --inspect instead (browser function names stay minified).");
  }
  return { bin, configJs };
}

// Runs next with the hook preloaded. Signals to cdt are passed on, so the
// child exits before cdt cleans up.
function runNext(sub, dir, next, args, env) {
  const confirmDir = mkdtempSync(join(tmpdir(), "cdt-next-"));
  const confirmFile = join(confirmDir, "confirm.json");
  const child = spawn(process.execPath, [next.bin, sub, ...args], {
    cwd: dir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
      CDT_NEXT_MODE: sub,
      CDT_NEXT_DIR: dir,
      CDT_NEXT_CONFIG_JS: next.configJs,
      CDT_NEXT_CONFIRM: confirmFile,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(HOOK)}`.trim(),
    },
  });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const forward = (sig) => child.kill(sig);
  signals.forEach((s) => process.on(s, forward));
  let exited = false;
  const exit = new Promise((res) => child.on("exit", (c, sig) => {
    exited = true;
    signals.forEach((s) => process.off(s, forward));
    res(c ?? (sig ? 1 : 0));
  }));
  return {
    child,
    exit,
    get exited() { return exited; },
    // What the hook reported at Next's first loadConfig, or null.
    confirmed: () => { try { return JSON.parse(readFileSync(confirmFile, "utf8")); } catch { return null; } },
    cleanup: () => rmSync(confirmDir, { recursive: true, force: true }),
  };
}

function printSettle(dir, r, who) {
  for (const f of r.restored) console.log(`cdt: restored ${rel(dir, f)} to its state before ${who}`);
  for (const f of r.removed) console.log(`cdt: removed ${rel(dir, f)}, which ${who} created`);
  for (const { file, why } of r.left) console.log(`cdt: ${rel(dir, file)} ${why}`);
}

// Records left by a cdt that was killed mid-build: finish that restore
// before anything else.
function recover(dir, gdir) {
  if (!existsSync(gdir)) return;
  const live = guard.liveRun(gdir);
  if (live) throw new Error(`another cdt next build for ${dir} is still running (pid ${live.pid}); wait for it or stop it, then rerun`);
  console.log("cdt: finishing the cleanup of an interrupted profiling build");
  printSettle(dir, guard.settle(gdir), "the interrupted build");
}

// Read-only: lists what else git sees changed since the build started.
function gitReport(dir, before, userDist, managed) {
  if (before.error) return void console.log(`cdt: git status unavailable (${before.error}), so cdt cannot report other changes made during the build`);
  const after = gitStatus(dir);
  if (after.error) return void console.log(`cdt: git status failed after the build (${after.error})`);
  const changed = [...after.entries].filter(([f, code]) => before.entries.get(f) !== code && !managed.has(f) && !(userDist && inside(f, userDist)));
  if (!changed.length) return;
  const names = changed.slice(0, 10).map(([f, code]) => `${code.trim()} ${rel(dir, f)}`).join(", ");
  console.log(`cdt: git reports other changes since the build started, left as is: ${names}${changed.length > 10 ? ` (+${changed.length - 10} more)` : ""}`);
}

function countFiles(dir, re) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true }).filter((f) => re.test(String(f))).length;
}

async function build(opts, dir, args) {
  const gdir = guard.guardDir(dir);
  recover(dir, gdir);
  for (const f of ["tsconfig.json", "next-env.d.ts"]) {
    if (guard.readOrNull(join(dir, f))?.includes(MARK)) {
      throw new Error(`${f} mentions ${MARK}, left by an earlier profiling build cdt has no record of. Remove the ${MARK} entries (Next adds them for the profiling distDir), then rerun.`);
    }
  }
  const next = resolveNext(dir, "build");
  const gitBefore = gitStatus(dir);
  const started = Date.now();
  guard.startRun(gdir, { project: dir, cdtPid: process.pid, started });
  const run = runNext("build", dir, next, args, { CDT_NEXT_GUARD: gdir });
  guard.startRun(gdir, { project: dir, cdtPid: process.pid, childPid: run.child.pid, started });
  const code = await run.exit;
  const info = run.confirmed();
  run.cleanup();

  const managed = guard.managedFiles(gdir);
  const settled = guard.settle(gdir);
  printSettle(dir, settled, "next build");
  const userDist = info && join(dir, info.userDistDir);
  gitReport(dir, gitBefore, userDist, managed);

  const problems = [];
  if (settled.left.some(({ file }) => guard.readOrNull(file)?.includes(MARK))) {
    problems.push(`a project file still mentions ${MARK} (see above); fix it by hand before the next build`);
  }
  if (!info) problems.push("the hook never patched Next's config");
  else {
    if (sha(join(userDist, "BUILD_ID")) !== info.userBuildId) {
      problems.push(`your own build in ${userDist} changed (BUILD_ID differs), so the output redirect did not hold. Rebuild it with next build.`);
    }
    const id = join(dir, info.distDir, "BUILD_ID");
    if (code === 0 && (!existsSync(id) || statSync(id).mtimeMs < started - 1000)) problems.push(`no fresh profiling build in ${join(dir, info.distDir)}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`cdt: ${p}`);
    process.exitCode = code || 1;
    return;
  }
  process.exitCode = code;
  if (code !== 0) return;
  const out = join(dir, info.distDir);
  writeFileSync(join(out, BUILD_INFO), JSON.stringify({ started, head: git(dir, ["rev-parse", "HEAD"]).out?.trim() ?? null }));
  const server = countFiles(join(out, "server"), /\.js\.map$/);
  const browser = countFiles(join(out, "static"), /\.js\.map$/);
  console.log(`cdt: profiling build in ${out}: ${server} server and ${browser} browser source maps; your own build and next.config untouched`);
  if (!gitBefore.error && git(dir, ["check-ignore", "-q", out]).error) console.log(`cdt: note: git does not ignore ${rel(dir, out)}; add it to .gitignore`);
  if (!server || !browser) console.log("cdt: some maps are missing; function names for that side will stay minified");
  console.log(`cdt: serve it with "cdt next start${opts.dir ? ` --dir ${opts.dir}` : ""}" (adds --inspect)`);
}

// Why the profiling build may be older than the source (a new commit, or
// a modified or new file newer than the build), or null.
function staleness(dir, out, userDist) {
  let built;
  try { built = JSON.parse(readFileSync(join(out, BUILD_INFO), "utf8")); } catch { return "it has no build record from cdt"; }
  const head = git(dir, ["rev-parse", "HEAD"]);
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (head.error || top.error) return null;
  if (built.head && head.out.trim() !== built.head) return `git HEAD moved since it was built (${built.head.slice(0, 8)} → ${head.out.trim().slice(0, 8)})`;
  const files = git(dir, ["ls-files", "-m", "-o", "--exclude-standard", "-z", "--full-name", "--", "."]);
  if (files.error) return null;
  const newer = files.out.split("\0").filter(Boolean).map((f) => join(top.out.trim(), f))
    .filter((f) => !inside(f, userDist) && existsSync(f) && statSync(f).mtimeMs > built.started);
  if (!newer.length) return null;
  return `${newer.slice(0, 3).map((f) => rel(dir, f)).join(", ")}${newer.length > 3 ? ` (+${newer.length - 3} more)` : ""} changed after it was built`;
}

async function start(opts, dir, args) {
  const next = resolveNext(dir, "start");
  const run = runNext("start", dir, next, args.some((a) => a.startsWith("--inspect")) ? args : ["--inspect", ...args], {});
  // The server loads its config at startup. No confirmation means it is
  // not serving the profiling build, so stop it rather than measure the
  // wrong thing.
  for (let i = 0; i < 300 && !run.exited && !run.confirmed(); i++) await sleep(100);
  const info = run.confirmed();
  const problems = [];
  if (!run.exited && !info) {
    problems.push("the hook did not confirm Next's config was patched within 30s, so the server was stopped");
    run.child.kill("SIGTERM");
  } else if (!run.exited) {
    const out = join(dir, info.distDir);
    console.log(`cdt: next start is serving ${out} with source maps (inspector: --inspect, default port 9229)`);
    const stale = staleness(dir, out, join(dir, info.userDistDir));
    if (stale) console.log(`cdt: warning: the profiling build may be older than your source: ${stale}. Rebuild with "cdt next build".`);
  }
  const code = await run.exit;
  run.cleanup();
  if (info && sha(join(dir, info.userDistDir, "BUILD_ID")) !== info.userBuildId) {
    problems.push(`your own build in ${join(dir, info.userDistDir)} changed (BUILD_ID differs) while the profiling server ran`);
  }
  for (const p of problems) console.error(`cdt: ${p}`);
  process.exitCode = code || (problems.length ? 1 : 0);
}

export async function nextWithSourceMaps(opts, pos) {
  const [sub, ...args] = pos;
  if (!["build", "start"].includes(sub)) throw new Error("usage: cdt next build|start [--dir app] [-- next args]");
  if (typeof module.registerHooks !== "function") throw new Error(`cdt next needs Node 22.15+ or 23.5+ (module.registerHooks); this is ${process.version}`);
  // Next takes its project folder as a positional argument; cdt guards the
  // one --dir names, so the two must not differ. (The hook also refuses a
  // mismatch before Next writes anything.)
  const dirArg = args.find((a) => !a.startsWith("-") && existsSync(a) && statSync(a).isDirectory());
  if (dirArg) throw new Error(`pass the app folder as --dir ${dirArg}, not after --`);
  const dir = realpathSync(resolve(opts.dir ?? "."));
  return sub === "build" ? build(opts, dir, args) : start(opts, dir, args);
}
