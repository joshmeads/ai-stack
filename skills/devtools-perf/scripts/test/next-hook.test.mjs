// `cdt next` against a fake Next installed as a symlink to a directory not
// named "next": Next never writes the project's files, its dependency
// installer is refused, the user's own distDir is refused at the filesystem
// even when the config patch did not apply, and anything the hook does not
// recognise stops the run before Next writes.
// Run from skills/devtools-perf: node --test 'scripts/test/*.test.mjs'

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG_JS, writeFakeNext } from "./fake-next.mjs";

const CDT = fileURLToPath(new URL("../cdt.mjs", import.meta.url));
const HOOK = fileURLToPath(new URL("../next-sourcemaps-hook.cjs", import.meta.url));
const TSCONFIG = '{\n    "compilerOptions": {}\n}\n'; // a layout Next's rewrite changes
const WATCHED = ["package.json", "tsconfig.json", "next-env.d.ts", ".next/BUILD_ID"];

// <root>/app, with its own build in .next and node_modules/next a symlink
// to <root>/vendor/framework-16.
function project(t, { overrides, userConfig = "{}" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cdt-hook-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vendor = join(root, "vendor", "framework-16");
  writeFakeNext(vendor, overrides);
  const app = join(root, "app");
  mkdirSync(join(app, "node_modules"), { recursive: true });
  symlinkSync(vendor, join(app, "node_modules", "next"));
  writeFileSync(join(app, "package.json"), '{ "name": "app" }\n');
  writeFileSync(join(app, "next.config.json"), userConfig);
  writeFileSync(join(app, "tsconfig.json"), TSCONFIG);
  mkdirSync(join(app, ".next"));
  writeFileSync(join(app, ".next", "BUILD_ID"), "users-own-build");
  return { root, app, vendor };
}

const files = (app) => Object.fromEntries(WATCHED.map((f) => [f, existsSync(join(app, f)) ? readFileSync(join(app, f), "utf8") : null]));

function cdtBuild(app, { scenario = "", nodeOptions = "" } = {}) {
  const r = spawnSync(process.execPath, [CDT, "next", "build", "--dir", app], {
    encoding: "utf8",
    env: { ...process.env, FAKE_SCENARIO: scenario, NODE_OPTIONS: nodeOptions },
  });
  return { ...r, text: r.stdout + r.stderr };
}

test("skips Next's writes to tsconfig and next-env.d.ts; matches Next by real path, with or without --preserve-symlinks", (t) => {
  for (const nodeOptions of ["", "--preserve-symlinks"]) {
    const { app } = project(t);
    const before = files(app);
    const r = cdtBuild(app, { nodeOptions });
    assert.equal(r.status, 0, r.text);
    assert.deepEqual(files(app), before, "project files and the user's BUILD_ID are byte-identical");
    assert.ok(existsSync(join(app, ".next", "cdt-profile", "BUILD_ID")));
    assert.match(r.text, /skipped Next's write to tsconfig\.json, left as is; Next wanted to add .*\.next\/cdt-profile\/types/);
    assert.match(r.text, /skipped Next's write to next-env\.d\.ts: it would have created it/);
  }
});

test("refuses Next's automatic dependency install", (t) => {
  const { app } = project(t);
  const before = files(app);
  const r = cdtBuild(app, { scenario: "install" });
  assert.notEqual(r.status, 0);
  assert.match(r.text, /wanted to install missing TypeScript packages/);
  assert.deepEqual(files(app), before);
});

test("refuses writes to the user's distDir at the filesystem when the config patch did not apply", (t) => {
  const { root, app } = project(t);
  // Wraps the compile step before the hook does, so it sees and strips the
  // hook's patches: Next then runs with its own distDir, as if the patch
  // had not matched.
  const unpatch = join(root, "unpatch.cjs");
  writeFileSync(unpatch, `if (process.env.CDT_NEXT_MODE) {
  const M = require("node:module"), compile = M.prototype._compile;
  M.prototype._compile = function (s, f, ...rest) {
    if (f === ${JSON.stringify(HOOK)}) return compile.call(this, s, f, ...rest);
    const cut = s.indexOf("\\n;{\\n  const __cdtLoadConfig");
    return compile.call(this, (cut < 0 ? s : s.slice(0, cut)).replace(/\\n;globalThis\\.__cdtEntryLoaded\\(.*\\);\\n/, "\\n"), f, ...rest);
  };
  require(${JSON.stringify(HOOK)});
}`);
  const before = files(app);
  const r = cdtBuild(app, { nodeOptions: `--require ${unpatch}` });
  assert.notEqual(r.status, 0);
  assert.match(r.text, /refused mkdir on \.next: it is inside your own build/);
  assert.match(r.text, /the hook never patched Next's config/);
  assert.deepEqual(files(app), before);
});

// Runs `require(entry)` in the app with the hook preloaded (start mode) and
// prints what loadConfig resolved or threw.
function hook(t, { overrides, userConfig, entry = "next/dist/server/config.js" }) {
  const { root, app, vendor } = project(t, { overrides, userConfig });
  const report = join(root, "report");
  mkdirSync(report);
  const script = `const m = require(${JSON.stringify(entry)});
    if (${entry.endsWith("config.js")}) m.default("phase-production-server", process.cwd()).then(() => console.log("loaded"), (e) => console.log("ERR " + e.message));`;
  const r = spawnSync(process.execPath, ["--require", HOOK, "-e", script], {
    cwd: app,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      CDT_NEXT_MODE: "start",
      CDT_NEXT_DIR: app,
      CDT_NEXT_CONFIG_JS: join(vendor, "dist", "server", "config.js"),
      CDT_NEXT_ENTRIES: JSON.stringify(["build/index.js", "server/lib/start-server.js"].map((e) => join(vendor, "dist", e))),
      CDT_NEXT_INSTALLER: join(vendor, "dist", "lib", "helpers", "install.js"),
      CDT_NEXT_DIST: ".next",
      CDT_NEXT_TSCONFIG: join(app, "tsconfig.json"),
      CDT_NEXT_REPORT: report,
    },
  });
  return r.stdout + r.stderr;
}

test("refuses output: 'export', adapterPath, an unrecognised or by-value loader, and a second copy of it", (t) => {
  assert.match(hook(t, { userConfig: '{"output":"export"}' }), /ERR cdt next: output: 'export'/);
  assert.match(hook(t, { userConfig: '{"adapterPath":"./adapter.js"}' }), /ERR cdt next: adapterPath is set/);
  assert.match(hook(t, { overrides: { "dist/server/config.js": "exports.default = async () => ({});\n" } }), /config loader is not recognised/);
  const byValue = CONFIG_JS.replace(/Object\.defineProperty\(exports, "default"[^\n]*\n/, "") + "exports.default = loadConfig;\n";
  assert.match(hook(t, { overrides: { "dist/server/config.js": byValue } }), /exports loadConfig by value/);
  const second = hook(t, { overrides: { "dist/other/next/dist/server/config.js": CONFIG_JS }, entry: "next/dist/other/next/dist/server/config.js" });
  assert.match(second, /a second copy of Next's config loader/);
});

test("a build entry whose loader was not wrapped stops before running", (t) => {
  // build/index.js that reaches the config through a module the hook does
  // not see as Next's loader.
  const overrides = {
    "dist/server/loader.js": CONFIG_JS,
    "dist/build/index.js": 'const c = require("../server/loader.js");\nexports.default = async () => {};\n',
  };
  assert.match(hook(t, { overrides, entry: "next/dist/build/index.js" }), /loaded without cdt's wrapper/);
});
