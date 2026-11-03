// `cdt next build|start`: the project's own next with source maps forced on
// and output redirected to <distDir>/cdt-profile, through a preloaded hook
// (next-sourcemaps-hook.cjs) that wraps Next's loadConfig in memory, skips
// Next's writes to the project's tsconfig and next-env.d.ts, and refuses any
// Node fs change to the user's own distDir. Fails closed: if the redirect
// cannot be confirmed, cdt exits non-zero.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./util.mjs";

const MARK = "cdt-profile";
const HOOK = fileURLToPath(new URL("../next-sourcemaps-hook.cjs", import.meta.url));
const BUILD_INFO = "cdt-build.json";

const readOrNull = (f) => { try { return readFileSync(f); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const sha = (f) => { const b = readOrNull(f); return b && createHash("sha256").update(b).digest("hex"); };
const inside = (f, d) => f === d || f.startsWith(d + sep);
const rel = (dir, f) => relative(dir, f) || f;

function git(cwd, args) {
  const r = spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { maxBuffer: 64 << 20 });
  if (r.error) return { status: null, error: r.error.message };
  const out = r.stdout.toString();
  return r.status === 0 ? { status: 0, out } : { status: r.status, out, error: r.stderr.toString().trim().split("\n")[0] || `git exited ${r.status}` };
}

// path -> "XY" status for what git reports under dir, outside skip (paths
// only), or { error } when git cannot say.
function gitStatus(dir, skip) {
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
    const f = join(top.out.trim(), e.slice(3));
    if (!inside(f, skip)) entries.set(f, e.slice(0, 2));
  }
  return { entries };
}

// The source the profiling build was made from: HEAD plus every file git
// sees as changed (staged, unstaged, untracked or deleted) with a hash of
// its content. Null outside git.
function sourceState(dir, userDist) {
  const st = gitStatus(dir, userDist);
  if (st.error) return null;
  const head = git(dir, ["rev-parse", "HEAD"]);
  return {
    head: head.error ? null : head.out.trim(),
    files: Object.fromEntries([...st.entries].map(([f, code]) => {
      let h;
      try { h = sha(f) ?? "absent"; } catch { h = "unreadable"; } // a submodule directory, say
      return [rel(dir, f), `${code} ${h}`];
    })),
  };
}

// Why the profiling build may not match the source, or null.
function staleness(dir, out, userDist) {
  let built;
  try { built = JSON.parse(readFileSync(join(out, BUILD_INFO), "utf8")); } catch { return "it has no build record from cdt"; }
  const now = sourceState(dir, userDist);
  if (!now || !built.source) return null;
  if (now.head !== built.source.head) return `git HEAD moved since it was built (${built.source.head?.slice(0, 8)} → ${now.head?.slice(0, 8)})`;
  const changed = [...new Set([...Object.keys(now.files), ...Object.keys(built.source.files)])].filter((f) => now.files[f] !== built.source.files[f]);
  if (!changed.length) return null;
  return `${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ` (+${changed.length - 3} more)` : ""} changed since it was built`;
}

// The hook patches Next by text and matches its modules by real path;
// refuse before running a Next whose modules do not look like the ones it
// knows.
function resolveNext(dir, sub) {
  const req = createRequire(join(dir, "package.json"));
  const at = (m) => realpathSync(req.resolve(`next/dist/${m}`));
  let next;
  try {
    next = {
      bin: req.resolve("next/dist/bin/next"),
      configJs: at("server/config.js"),
      // Modules `next build|start` require before doing anything; by the
      // end of their bodies Next's config loader is loaded.
      entries: [sub === "build" ? "build/index.js" : "server/lib/start-server.js"].map(at),
      installer: at("lib/helpers/install.js"),
    };
  } catch {
    throw new Error(`no next package resolvable from ${dir}, or not one cdt recognises; pass --dir <the app folder>`);
  }
  const src = readFileSync(next.configJs, "utf8");
  const known = /\nasync function loadConfig\(/.test(src) && /return loadConfig;/.test(src)
    && /\nfunction install\(/.test(readFileSync(next.installer, "utf8"))
    && (sub !== "build" || readFileSync(join(dirname(dirname(next.configJs)), "build", "index.js"), "utf8").includes('require("../server/config")'));
  if (!known) {
    throw new Error(`this Next version (${dirname(dirname(next.configJs))}) is not one cdt recognises, so it cannot redirect the build safely. `
      + "Use next build && next start --inspect instead (browser function names stay minified).");
  }
  return next;
}

// The settings cdt must know before Next runs, read with Next's own loader
// in a separate process (the hook then holds Next to the same values).
function readConfig(dir, next, sub) {
  const phase = sub === "build" ? "phase-production-build" : "phase-production-server";
  const script = `require(${JSON.stringify(next.configJs)}).default(${JSON.stringify(phase)}, ${JSON.stringify(dir)}, { silent: true }).then((c) => {
    require("fs").writeSync(1, "\\n@@cdt " + JSON.stringify({ distDir: c.distDir, tsconfigPath: c.typescript?.tsconfigPath || "tsconfig.json", output: c.output ?? null, adapterPath: c.adapterPath ?? null }) + "\\n");
    process.exit(0);
  }, (e) => { console.error(e.message); process.exit(1); });`;
  const r = spawnSync(process.execPath, ["-e", script], { cwd: dir, encoding: "utf8", env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" } });
  const line = r.stdout?.split("\n").find((l) => l.startsWith("@@cdt "));
  if (r.status !== 0 || !line) throw new Error(`could not read the Next config in ${dir}: ${(r.stderr || r.error?.message || "").trim().split("\n")[0]}`);
  const c = JSON.parse(line.slice(6));
  if (c.output === "export") throw new Error("output: 'export' writes build artifacts to .next whatever distDir says, so cdt cannot keep your build untouched. Profile without output: 'export'.");
  if (c.adapterPath) throw new Error("adapterPath is set: the adapter writes deployment output wherever it likes, outside cdt-profile. Profile without adapterPath.");
  return { userDist: join(dir, c.distDir), distDir: c.distDir, tsconfig: join(dir, c.tsconfigPath) };
}

// Runs next with the hook preloaded. Signals to cdt are passed on, so the
// child exits before cdt does.
function runNext(sub, dir, next, cfg, args) {
  const report = mkdtempSync(join(tmpdir(), "cdt-next-"));
  const child = spawn(process.execPath, [next.bin, sub, ...args], {
    cwd: dir,
    stdio: "inherit",
    env: {
      ...process.env,
      CDT_NEXT_MODE: sub,
      CDT_NEXT_DIR: dir,
      CDT_NEXT_CONFIG_JS: next.configJs,
      CDT_NEXT_ENTRIES: JSON.stringify(next.entries),
      CDT_NEXT_INSTALLER: next.installer,
      CDT_NEXT_DIST: cfg.distDir,
      CDT_NEXT_TSCONFIG: cfg.tsconfig,
      CDT_NEXT_REPORT: report,
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
    confirmed: () => { try { return JSON.parse(readFileSync(join(report, "confirm.json"), "utf8")); } catch { return null; } },
    // The project-file writes the hook skipped: file -> what Next wanted.
    skipped: () => {
      const lines = readOrNull(join(report, "skipped.jsonl"))?.toString().split("\n").filter(Boolean) ?? [];
      return new Map(lines.map((l) => JSON.parse(l)).map(({ file, wanted }) => [file, wanted]));
    },
    cleanup: () => rmSync(report, { recursive: true, force: true }),
  };
}

// One line per file: what Next's skipped write would have changed.
function printSkipped(dir, skipped) {
  for (const [file, wanted] of skipped) {
    const now = readOrNull(file)?.toString();
    if (now === wanted) continue;
    if (now === undefined) {
      console.log(`cdt: skipped Next's write to ${rel(dir, file)}: it would have created it (the profiling build does not need it)`);
      continue;
    }
    // Lines that carry content, ignoring layout (indent, trailing commas, brackets).
    const lines = (s) => new Set(s.split(/\r?\n/).map((l) => l.trim().replace(/,$/, "")).filter((l) => !/^[[\]{}(),]*$/.test(l)));
    const [a, b] = [lines(now), lines(wanted)];
    const added = [...b].filter((l) => !a.has(l)), removed = [...a].filter((l) => !b.has(l));
    const show = (ls) => ls.slice(0, 3).join(" ") + (ls.length > 3 ? ` (+${ls.length - 3} more)` : "");
    const what = [added.length && `add ${show(added)}`, removed.length && `remove ${show(removed)}`].filter(Boolean).join(" and ") || "reformat it";
    console.log(`cdt: skipped Next's write to ${rel(dir, file)}, left as is; Next wanted to ${what}`);
  }
}

// Files Next would point at the profiling build, left by older cdt
// versions that let Next write them.
function refuseLeftovers(dir, cfg) {
  for (const f of [cfg.tsconfig, join(dir, "next-env.d.ts")]) {
    if (readOrNull(f)?.includes(MARK)) {
      throw new Error(`${rel(dir, f)} mentions ${MARK}, left by an older cdt. Remove the ${MARK} entries from it, then rerun.`);
    }
  }
}

// Read-only: lists what git sees changed since the build started.
function gitReport(dir, before, userDist) {
  if (before.error) return void console.log(`cdt: git status unavailable (${before.error.replace(/^fatal: /, "")}), so cdt cannot list other files changed during the build`);
  const after = gitStatus(dir, userDist);
  if (after.error) return void console.log(`cdt: git status failed after the build (${after.error})`);
  const changed = [...after.entries].filter(([f, code]) => before.entries.get(f) !== code);
  if (!changed.length) return;
  const names = changed.slice(0, 10).map(([f, code]) => `${code.trim()} ${rel(dir, f)}`).join(", ");
  console.log(`cdt: git reports changes since the build started (not made by Next's Node code, which cdt guards): ${names}${changed.length > 10 ? ` (+${changed.length - 10} more)` : ""}`);
}

function countFiles(dir, re) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true }).filter((f) => re.test(String(f))).length;
}

async function build(opts, dir, args) {
  const next = resolveNext(dir, "build");
  const cfg = readConfig(dir, next, "build");
  refuseLeftovers(dir, cfg);
  const userBuildId = sha(join(cfg.userDist, "BUILD_ID"));
  const gitBefore = gitStatus(dir, cfg.userDist);
  const source = sourceState(dir, cfg.userDist);
  const started = Date.now();
  const run = runNext("build", dir, next, cfg, args);
  const code = await run.exit;
  const info = run.confirmed();
  printSkipped(dir, run.skipped());
  run.cleanup();
  gitReport(dir, gitBefore, cfg.userDist);

  const out = join(cfg.userDist, MARK);
  const problems = [];
  if (!info) problems.push("the hook never patched Next's config");
  if (sha(join(cfg.userDist, "BUILD_ID")) !== userBuildId) {
    problems.push(`your own build in ${cfg.userDist} changed (BUILD_ID differs), so the output redirect did not hold. Rebuild it with next build.`);
  }
  const id = join(out, "BUILD_ID");
  if (code === 0 && (!existsSync(id) || statSync(id).mtimeMs < started - 1000)) problems.push(`no fresh profiling build in ${out}`);
  if (problems.length) {
    for (const p of problems) console.error(`cdt: ${p}`);
    process.exitCode = code || 1;
    return;
  }
  process.exitCode = code;
  if (code !== 0) return;
  writeFileSync(join(out, BUILD_INFO), JSON.stringify({ started, source }));
  const server = countFiles(join(out, "server"), /\.js\.map$/);
  const browser = countFiles(join(out, "static"), /\.js\.map$/);
  console.log(`cdt: profiling build in ${out}: ${server} server and ${browser} browser source maps, types not checked; your own build, next.config, tsconfig and next-env.d.ts untouched`);
  if (!gitBefore.error && git(dir, ["check-ignore", "-q", out]).status === 1) console.log(`cdt: note: git does not ignore ${rel(dir, out)}; add it to .gitignore`);
  if (!server || !browser) console.log("cdt: some maps are missing; function names for that side will stay minified");
  console.log(`cdt: serve it with "cdt next start${opts.dir ? ` --dir ${opts.dir}` : ""}" (adds --inspect)`);
}

async function start(opts, dir, args) {
  const next = resolveNext(dir, "start");
  const cfg = readConfig(dir, next, "start");
  const userBuildId = sha(join(cfg.userDist, "BUILD_ID"));
  const run = runNext("start", dir, next, cfg, args.some((a) => a.startsWith("--inspect")) ? args : ["--inspect", ...args]);
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
    const out = join(cfg.userDist, MARK);
    console.log(`cdt: next start is serving ${out} with source maps (inspector: --inspect, default port 9229)`);
    const stale = staleness(dir, out, cfg.userDist);
    if (stale) console.log(`cdt: warning: the profiling build may not match your source: ${stale}. Rebuild with "cdt next build".`);
  }
  const code = await run.exit;
  run.cleanup();
  if (sha(join(cfg.userDist, "BUILD_ID")) !== userBuildId) {
    problems.push(`your own build in ${cfg.userDist} changed (BUILD_ID differs) while the profiling server ran`);
  }
  for (const p of problems) console.error(`cdt: ${p}`);
  process.exitCode = code || (problems.length ? 1 : 0);
}

export async function nextWithSourceMaps(opts, pos) {
  const [sub, ...args] = pos;
  if (!["build", "start"].includes(sub)) throw new Error("usage: cdt next build|start [--dir app] [-- next args]");
  // Next takes its project folder as a positional argument; cdt guards the
  // one --dir names, so the two must not differ. (The hook also refuses a
  // mismatch before Next writes anything.)
  const dirArg = args.find((a) => !a.startsWith("-") && existsSync(a) && statSync(a).isDirectory());
  if (dirArg) throw new Error(`pass the app folder as --dir ${dirArg}, not after --`);
  const dir = realpathSync(resolve(opts.dir ?? "."));
  return sub === "build" ? build(opts, dir, args) : start(opts, dir, args);
}
