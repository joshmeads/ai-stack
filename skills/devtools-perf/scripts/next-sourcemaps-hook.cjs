// Preloaded by `cdt next` (node --require) into Next and every Node process
// it spawns. Wraps Next's loadConfig in memory so the build and server use
// source maps and the separate distDir <distDir>/cdt-profile; next.config is
// never edited. Fails closed: anything that would let Next write to the
// project's own build throws first.
//
// During `next build` it also records, for cdt to undo, the bytes Next
// writes to the two project files it manages (see lib/next-guard.cjs).
const { registerHooks } = require("node:module");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { dirname, join, resolve, sep } = require("node:path");
const { fileURLToPath } = require("node:url");
const guard = require("./lib/next-guard.cjs");

const CONFIG_JS = process.env.CDT_NEXT_CONFIG_JS; // real path of the config loader cdt checked
const PROJECT = process.env.CDT_NEXT_DIR; // real path of the app
const CONFIRM = process.env.CDT_NEXT_CONFIRM; // this run's report back to cdt
const MODE = process.env.CDT_NEXT_MODE; // build | start
const GUARD = process.env.CDT_NEXT_GUARD; // build: where Next's writes are recorded
if (!CONFIG_JS || !PROJECT || !CONFIRM || !MODE || (MODE === "build" && !GUARD)) {
  throw new Error("cdt: next-sourcemaps-hook.cjs only runs under `cdt next`");
}
if (typeof registerHooks !== "function") throw new Error(`cdt: Node ${process.version} lacks module.registerHooks; cdt next needs Node 22.15+ or 23.5+`);

const { MARK } = guard;
const fail = (msg) => { throw new Error(`cdt next: ${msg}`); };
const sha = (f) => { const b = guard.readOrNull(f); return b && createHash("sha256").update(b).digest("hex"); };

// ---------- the loadConfig wrapper ----------

let userDistDir = null; // the app's own distDir, from this process's first loadConfig
let reported = false;

// Called by the patched loadConfig with each resolved (non-raw) config.
globalThis.__cdtNextConfig = (config, dir) => {
  if (config.output === "export") fail("output: 'export' writes build artifacts to .next whatever distDir says, so cdt cannot keep your build untouched. Profile without output: 'export'.");
  const real = fs.realpathSync(dir);
  if (real !== PROJECT) fail(`Next was asked to use ${real}, but cdt guards ${PROJECT}. Pass the app folder with --dir, not as an argument after --.`);
  // loadConfig caches its result, so later calls may return the object
  // this already changed.
  userDistDir ??= config.distDir ?? ".next";
  const distDir = join(userDistDir, MARK);
  if (config.distDir !== userDistDir && config.distDir !== distDir) fail(`Next's distDir changed between loads (${userDistDir}, then ${config.distDir})`);
  config.productionBrowserSourceMaps = true;
  config.experimental = { ...config.experimental, serverSourceMaps: true };
  config.distDir = distDir;
  if (config.distDir !== distDir || config.productionBrowserSourceMaps !== true || config.experimental.serverSourceMaps !== true) {
    fail("Next's config object refused the overrides; stopping before it builds into your own distDir");
  }
  if (reported) return;
  reported = true;
  // Next's own resolution (verify-typescript-setup, writeAppTypeDeclarations).
  const tsconfig = join(real, config.typescript?.tsconfigPath || "tsconfig.json");
  const nextEnv = join(real, "next-env.d.ts");
  if (MODE === "build") {
    for (const f of [tsconfig, nextEnv]) {
      if (guard.hasBefore(GUARD, f)) continue; // another Next process got here first
      const bytes = guard.readOrNull(f);
      if (bytes?.includes(MARK)) {
        fail(`${f} already mentions ${MARK}, left by an earlier profiling build cdt has no record of. Remove the ${MARK} entries (Next adds them for the profiling distDir), then rerun.`);
      }
      guard.recordBefore(GUARD, f, bytes);
    }
  }
  if (MODE === "start" && !fs.existsSync(join(real, distDir, "BUILD_ID"))) {
    fail(`no profiling build in ${join(real, distDir)}; run "cdt next build" first`);
  }
  try {
    fs.writeFileSync(CONFIRM, JSON.stringify({ pid: process.pid, dir: real, userDistDir, distDir, tsconfig, userBuildId: sha(join(real, userDistDir, "BUILD_ID")) }), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
};

// Config loaders patched in this process, by real path.
const patched = new Set();
globalThis.__cdtConfigPatched = (file) => patched.add(file);

// Appended to the modules `next build` and `next start` run first. By the
// end of their bodies they have required Next's config loader, so if it is
// not wrapped here, nothing has been written yet and the build stops.
globalThis.__cdtEntryLoaded = (file) => {
  const config = join(dirname(dirname(file)), "server", "config.js");
  let real = config;
  try { real = fs.realpathSync(config); } catch {}
  if (!patched.has(real)) fail(`${file} loaded without cdt's wrapper on ${config}; stopping before Next writes anything`);
};

// Appended to Next's server/config.js. rawConfig calls return the user's
// module itself (Turbopack's config validation); those pass through.
// The export check catches a Next that copies loadConfig into exports
// instead of reading the binding live, which would bypass the wrapper.
const patch = (file) => `
;{
  const __cdtLoadConfig = loadConfig;
  loadConfig = async function (phase, dir, opts) {
    const config = await __cdtLoadConfig.apply(this, arguments);
    if (opts && opts.rawConfig) return config;
    globalThis.__cdtNextConfig(config, dir);
    return config;
  };
  if (exports.default !== loadConfig) throw new Error("cdt next: this Next exports loadConfig by value, so the source-map wrapper cannot take effect");
  globalThis.__cdtConfigPatched(${JSON.stringify(file)});
}
`;

// Matched by path suffix on the loaded path and on its real path, so a
// symlinked or aliased Next (pnpm, --preserve-symlinks) is still caught.
const suffix = (rel) => sep + join("next", "dist", ...rel.split("/"));
const CONFIG_SUFFIX = suffix("server/config.js");
const ENTRY_SUFFIXES = ["build/index.js", "cli/next-build.js", "cli/next-start.js"].map(suffix);

function classify(file) {
  let real = file;
  try { real = fs.realpathSync(file); } catch {}
  for (const p of [file, real]) {
    if (p.endsWith(CONFIG_SUFFIX)) return { kind: "config", real };
    if (ENTRY_SUFFIXES.some((s) => p.endsWith(s))) return { kind: "entry", real };
  }
  return null;
}

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith("file:")) return result;
    const hit = classify(fileURLToPath(url));
    if (!hit) return result;
    const source = String(result.source);
    if (hit.kind === "entry") return { ...result, source: `${source}\n;globalThis.__cdtEntryLoaded(${JSON.stringify(hit.real)});\n` };
    if (hit.real !== CONFIG_JS) fail(`a second copy of Next's config loader was loaded (${hit.real}); cdt checked and patches only ${CONFIG_JS}`);
    if (!/\nasync function loadConfig\(/.test(source)) fail("this Next version's config loader is not recognised; stopping before it builds into your own distDir");
    return { ...result, source: source + patch(hit.real) };
  },
});

// ---------- recording Next's writes (build only) ----------

if (MODE === "build") {
  // Fixed once the first loadConfig has recorded both files.
  let managed = null;
  const isManaged = (p) => {
    if (managed) return managed.has(p);
    const now = guard.managedFiles(GUARD);
    if (now.size >= 2) managed = now;
    return now.has(p);
  };
  const pathOf = (file) => {
    if (typeof file === "string") return resolve(file);
    if (file instanceof URL) return fileURLToPath(file);
    if (Buffer.isBuffer(file)) return resolve(file.toString());
    return null; // a file descriptor or handle
  };
  // The bytes a write put on disk: from its arguments when they say,
  // otherwise read back.
  const bytesOf = (p, data, options) => {
    const flag = typeof options === "object" ? options?.flag : undefined;
    if (!(flag && String(flag).includes("a"))) {
      if (typeof data === "string") return Buffer.from(data, (typeof options === "string" ? options : options?.encoding) || "utf8");
      if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    return fs.readFileSync(p);
  };
  const note = (file, data, options) => {
    const p = pathOf(file);
    if (p && isManaged(p)) guard.recordWrite(GUARD, p, bytesOf(p, data, typeof options === "function" ? undefined : options));
  };

  const { writeFileSync, writeFile } = fs;
  const { writeFile: writeFileP } = fs.promises;
  fs.writeFileSync = function (file, data, options) {
    const r = writeFileSync.apply(this, arguments);
    note(file, data, options);
    return r;
  };
  fs.writeFile = function (file, data, options) {
    const args = [...arguments];
    const i = args.findLastIndex((a) => typeof a === "function");
    if (i > 0) {
      const done = args[i];
      args[i] = function (err) {
        if (!err) {
          try { note(file, data, options); } catch (e) { return done(e); }
        }
        return done.apply(this, arguments);
      };
    }
    return writeFile.apply(this, args);
  };
  fs.promises.writeFile = async function (file, data, options) {
    const r = await writeFileP.apply(this, arguments);
    note(file, data, options);
    return r;
  };
}
