const Module = require("node:module");
const fs = require("node:fs");
const { basename, dirname, join, relative, resolve, sep } = require("node:path");
const { fileURLToPath } = require("node:url");

const env = process.env;
const MODE = env.CDT_NEXT_MODE;
const PROJECT = env.CDT_NEXT_DIR;
const CONFIG_JS = env.CDT_NEXT_CONFIG_JS;
const ENTRIES = new Set(JSON.parse(env.CDT_NEXT_ENTRIES || "[]"));
const INSTALLER = env.CDT_NEXT_INSTALLER;
const USER_DIST = env.CDT_NEXT_DIST;
const TSCONFIG = env.CDT_NEXT_TSCONFIG;
const REPORT = env.CDT_NEXT_REPORT;
if (!MODE || !PROJECT || !CONFIG_JS || !ENTRIES.size || !INSTALLER || !USER_DIST || !TSCONFIG || !REPORT) {
  throw new Error("cdt: next-sourcemaps-hook.cjs only runs under `cdt next`");
}

const MARK = "cdt-profile";
const fail = (msg) => { throw new Error(`cdt next: ${msg}`); };
const { appendFileSync, writeFileSync, existsSync } = fs;
const realpath = fs.realpathSync.native;
const inside = (f, d) => f === d || f.startsWith(d + sep);

function real(p) {
  let head = resolve(p);
  const tail = [];
  for (;;) {
    try { return join(realpath(head), ...tail); } catch {}
    const up = dirname(head);
    if (up === head) return resolve(p);
    tail.unshift(basename(head));
    head = up;
  }
}

const DIST = real(join(PROJECT, USER_DIST));
const PROFILE = join(DIST, MARK);
const TS_REAL = real(TSCONFIG);
const MANAGED = new Set([TS_REAL, real(join(PROJECT, "next-env.d.ts"))]);
const shown = (f) => relative(PROJECT, f) || f;

let confirmed = false;

globalThis.__cdtNextConfig = (config, dir) => {
  if (config.output === "export") fail("output: 'export' writes build artifacts to .next whatever distDir says, so cdt cannot keep your build untouched. Profile without output: 'export'.");
  if (config.adapterPath) fail("adapterPath is set: the adapter writes deployment output wherever it likes, outside cdt-profile. Profile without adapterPath.");
  const dirReal = fs.realpathSync(dir);
  if (dirReal !== PROJECT) fail(`Next was asked to use ${dirReal}, but cdt guards ${PROJECT}. Pass the app folder with --dir, not as an argument after --.`);
  const distDir = join(USER_DIST, MARK);
  if (config.distDir !== USER_DIST && config.distDir !== distDir) fail(`Next's distDir is ${config.distDir} here, but ${USER_DIST} when cdt read the config before the run`);
  if (real(join(dirReal, config.typescript?.tsconfigPath || "tsconfig.json")) !== TS_REAL) fail("Next's typescript.tsconfigPath differs from the one cdt read before the run");
  config.productionBrowserSourceMaps = true;
  config.experimental = { ...config.experimental, serverSourceMaps: true };
  config.typescript = { ...config.typescript, ignoreBuildErrors: true };
  config.distDir = distDir;
  if (config.distDir !== distDir || config.productionBrowserSourceMaps !== true || config.experimental.serverSourceMaps !== true || config.typescript.ignoreBuildErrors !== true) {
    fail("Next's config object refused the overrides; stopping before it builds into your own distDir");
  }
  if (MODE === "start" && !existsSync(join(PROFILE, "BUILD_ID"))) fail(`no profiling build in ${PROFILE}; run "cdt next build" first`);
  if (confirmed) return;
  confirmed = true;
  try {
    writeFileSync(join(REPORT, "confirm.json"), JSON.stringify({ pid: process.pid, distDir }), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
};

const patched = new Set();
globalThis.__cdtConfigPatched = (file) => patched.add(file);

globalThis.__cdtEntryLoaded = (file) => {
  if (!patched.has(CONFIG_JS)) fail(`${file} loaded without cdt's wrapper on ${CONFIG_JS}; stopping before Next writes anything`);
};

const configPatch = `
;{
  const __cdtLoadConfig = loadConfig;
  loadConfig = async function (phase, dir, opts) {
    const config = await __cdtLoadConfig.apply(this, arguments);
    if (opts && opts.rawConfig) return config;
    globalThis.__cdtNextConfig(config, dir);
    return config;
  };
  if (exports.default !== loadConfig) throw new Error("cdt next: this Next exports loadConfig by value, so the source-map wrapper cannot take effect");
  globalThis.__cdtConfigPatched(${JSON.stringify(CONFIG_JS)});
}
`;

const installerPatch = `
;install = function () {
  throw new Error("cdt next: Next wanted to install missing TypeScript packages, which edits package.json and the lockfile. Install your project's dependencies first, then rerun.");
};
`;

const SECOND_CONFIG = sep + join("next", "dist", "server", "config.js");

function patchSource(source, file) {
  let r = file;
  try { r = realpath(file); } catch {}
  if (r === CONFIG_JS) {
    if (!/\nasync function loadConfig\(/.test(source)) fail("this Next version's config loader is not recognised; stopping before it builds into your own distDir");
    return source + configPatch;
  }
  if (ENTRIES.has(r)) return `${source}\n;globalThis.__cdtEntryLoaded(${JSON.stringify(r)});\n`;
  if (r === INSTALLER) {
    if (!/\nfunction install\(/.test(source)) fail("this Next version's package installer is not recognised");
    return source + installerPatch;
  }
  if (file.endsWith(SECOND_CONFIG) || r.endsWith(SECOND_CONFIG)) fail(`a second copy of Next's config loader was loaded (${r}); cdt checked and patches only ${CONFIG_JS}`);
  return source;
}

const compile = Module.prototype._compile;
if (typeof compile !== "function") fail(`Node ${process.version} has no Module.prototype._compile to patch`);
Module.prototype._compile = function (content, filename, ...rest) {
  return compile.call(this, typeof content === "string" ? patchSource(content, filename) : content, filename, ...rest);
};

function reportSkip(file, data, options) {
  const enc = (typeof options === "string" ? options : options?.encoding) || "utf8";
  const wanted = typeof data === "string" ? data : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(enc) : String(data);
  appendFileSync(join(REPORT, "skipped.jsonl"), JSON.stringify({ file, wanted }) + "\n");
}

const refusal = (op, file, why) => Object.assign(new Error(`cdt next: refused ${op} on ${shown(file)}: ${why}`), { code: "ECDTNEXT" });

const pathOf = (p) => (typeof p === "string" ? p : p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : null);

const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
const writesTo = (flags) => (typeof flags === "number" ? (flags & WRITE_FLAGS) !== 0 : /[wa+]/.test(String(flags ?? "r")));

const MUTATORS = {
  writeFile: [0], appendFile: [0], truncate: [0], open: [0], mkdir: [0], mkdtemp: [0],
  rm: [0], rmdir: [0], unlink: [0], rename: [0, 1], copyFile: [1], cp: [1], symlink: [1], link: [1],
};
const REMOVES = new Set(["rm", "rmdir", "rename"]);

function decide(op, args) {
  if (op === "open" && !writesTo(args[1])) return null;
  for (const i of MUTATORS[op]) {
    const p = pathOf(args[i]);
    if (p === null) continue;
    const t = real(p);
    if (MANAGED.has(t)) {
      if (op !== "writeFile") return refusal(op, t, "cdt never lets Next change this project file");
      if (t === TS_REAL && !existsSync(t)) return refusal("writeFile", t, "Next wants to create it, and cdt never creates project files. Create a tsconfig.json (next build does) and rerun.");
      reportSkip(t, args[1], args[2]);
      return "skip";
    }
    if (inside(t, DIST) && !inside(t, PROFILE)) return refusal(op, t, `it is inside your own build (${shown(DIST)}), and the profiling build may only write ${shown(PROFILE)}. cdt's redirect did not take effect; nothing was changed.`);
    if (REMOVES.has(op) && inside(DIST, t)) return refusal(op, t, `it holds your own build (${shown(DIST)})`);
  }
  return null;
}

function wrap(obj, name, op, kind) {
  const orig = obj[name];
  if (typeof orig !== "function") return;
  obj[name] = function (...args) {
    const d = decide(op, args);
    if (d === null) return orig.apply(this, args);
    const err = d === "skip" ? null : d;
    if (kind === "sync") { if (err) throw err; return undefined; }
    if (kind === "promise") return err ? Promise.reject(err) : Promise.resolve();
    const cb = args.findLast((a) => typeof a === "function");
    if (!cb) { if (err) throw err; return undefined; }
    process.nextTick(cb, err);
  };
}

for (const op of Object.keys(MUTATORS)) {
  wrap(fs, op, op, "callback");
  wrap(fs, `${op}Sync`, op, "sync");
  wrap(fs.promises, op, op, "promise");
}
Module.syncBuiltinESMExports();
