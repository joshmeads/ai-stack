// The preloaded hook fails closed: it patches Next's config loader wherever
// it is loaded from, and throws before Next can write when it cannot.
// Run: node --test skills/devtools-perf/scripts/test/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG_JS, writeFakeNext } from "./fake-next.mjs";

const HOOK = fileURLToPath(new URL("../next-sourcemaps-hook.cjs", import.meta.url));

// A fake next under <root>/real/next, installed in <root>/app/node_modules
// as a symlink (pnpm-style). `entry` is required from the app with the hook
// preloaded; the script prints the config loadConfig resolves.
function run(t, { overrides, entry = "next/dist/server/config.js", nodeArgs = [], userConfig = "{}" }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cdt-hook-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, "real", "next");
  writeFakeNext(real, overrides);
  const app = join(root, "app");
  mkdirSync(join(app, "node_modules"), { recursive: true });
  symlinkSync(real, join(app, "node_modules", "next"));
  writeFileSync(join(app, "next.config.json"), userConfig);
  const script = `const m = require(${JSON.stringify(entry)});
    if (m.default && ${entry.endsWith("config.js")}) m.default("phase-production-build", process.cwd()).then((c) => console.log("distDir=" + c.distDir + " maps=" + c.productionBrowserSourceMaps), (e) => { console.log("ERR " + e.message); });`;
  const r = spawnSync(process.execPath, [...nodeArgs, "--require", HOOK, "-e", script], {
    cwd: app,
    encoding: "utf8",
    env: {
      ...process.env,
      CDT_NEXT_MODE: "start",
      CDT_NEXT_DIR: app,
      CDT_NEXT_CONFIG_JS: join(real, "dist", "server", "config.js"),
      CDT_NEXT_CONFIRM: join(root, "confirm.json"),
    },
  });
  return r.stdout + r.stderr;
}

test("patches the loader through a symlinked next, with or without --preserve-symlinks", (t) => {
  // start mode wants a profiling build to exist; the error proves the
  // redirect ran (distDir .next/cdt-profile) for both resolutions.
  for (const nodeArgs of [[], ["--preserve-symlinks"]]) {
    assert.match(run(t, { nodeArgs }), /ERR cdt next: no profiling build in .*\.next\/cdt-profile/);
  }
});

test("refuses an unrecognised loader, a by-value export, and output: 'export'", (t) => {
  assert.match(run(t, { overrides: { "dist/server/config.js": "exports.default = async () => ({});\n" } }), /config loader is not recognised/);
  const byValue = CONFIG_JS.replace(/Object\.defineProperty\(exports, "default"[^\n]*\n/, "") + "exports.default = loadConfig;\n";
  assert.match(run(t, { overrides: { "dist/server/config.js": byValue } }), /exports loadConfig by value/);
  assert.match(run(t, { userConfig: '{"output":"export"}' }), /ERR cdt next: output: 'export'/);
});

test("refuses a second copy of Next's loader", (t) => {
  // The app requires a config.js that is not the one cdt checked.
  const out = run(t, { overrides: { "dist/other/next/dist/server/config.js": CONFIG_JS }, entry: "next/dist/other/next/dist/server/config.js" });
  assert.match(out, /a second copy of Next's config loader/);
});

test("a build entry whose loader was not wrapped stops before running", (t) => {
  // build/index.js that reaches the config through a path the hook does
  // not see as Next's loader.
  const overrides = {
    "dist/server/loader.js": CONFIG_JS,
    "dist/build/index.js": 'const c = require("../server/loader.js");\nexports.default = async () => { require("fs").writeFileSync("WROTE", "x"); };\n',
  };
  assert.match(run(t, { overrides, entry: "next/dist/build/index.js" }), /loaded without cdt's wrapper/);
});
