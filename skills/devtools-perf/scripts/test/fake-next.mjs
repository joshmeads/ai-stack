// A minimal stand-in for the next package: the same module layout and the
// loadConfig shape cdt's hook patches, and a build that writes tsconfig and
// next-env.d.ts the way Next does. FAKE_SCENARIO makes the build simulate a
// user edit after Next's writes ("edit") or kill cdt mid-build ("kill").

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CONFIG_JS = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "default", { enumerable: true, get: function() { return loadConfig; } });
const fs = require("fs");
const path = require("path");
async function loadConfig(phase, dir, opts = {}) {
  const f = path.join(dir, "next.config.json");
  const user = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  if (opts.rawConfig) return user;
  return { distDir: ".next", ...user, experimental: { ...user.experimental } };
}
`;

const BUILD_JS = `"use strict";
const _config = require("../server/config");
const fs = require("fs");
const path = require("path");
exports.default = async function build(dir) {
  const config = await _config.default("phase-production-build", dir);
  const ts = path.join(dir, config.typescript?.tsconfigPath || "tsconfig.json");
  if (!fs.existsSync(ts)) fs.writeFileSync(ts, "{}\\n");
  const t = JSON.parse(fs.readFileSync(ts, "utf8"));
  t.include = [...(t.include ?? []), config.distDir + "/types/**/*.ts"];
  fs.writeFileSync(ts, JSON.stringify(t, null, 2) + "\\n");
  await fs.promises.writeFile(path.join(dir, "next-env.d.ts"), 'import "./' + config.distDir + '/types/routes.d.ts";\\n');
  const out = path.join(dir, config.distDir);
  for (const d of ["server", "static"]) {
    fs.mkdirSync(path.join(out, d), { recursive: true });
    fs.writeFileSync(path.join(out, d, "a.js.map"), "{}");
  }
  fs.writeFileSync(path.join(out, "BUILD_ID"), String(Date.now()));
  if (process.env.FAKE_SCENARIO === "edit") {
    // Someone edits tsconfig after Next's write (not through fs.writeFile*)
    // and adds a note that mentions the profiling dir.
    const fd = fs.openSync(ts, "w");
    fs.writeSync(fd, '{ "edited": "by hand after the build wrote ' + config.distDir + '" }\\n');
    fs.closeSync(fd);
    const nd = fs.openSync(path.join(dir, "PERF-NOTES.md"), "w");
    fs.writeSync(nd, "measured against " + config.distDir + "\\n");
    fs.closeSync(nd);
  }
  if (process.env.FAKE_SCENARIO === "kill") process.kill(process.ppid, "SIGKILL");
};
`;

const FILES = {
  "package.json": '{ "name": "next", "version": "0.0.0-fake" }\n',
  "dist/bin/next": "const [sub, ...rest] = process.argv.slice(2);\nimport(`../cli/next-${sub}.js`).then((m) => m.run(rest));\n",
  "dist/cli/next-build.js": 'const b = require("../build/index.js");\nexports.run = () => b.default(process.cwd()).catch((e) => { console.error(e.message); process.exit(1); });\n',
  "dist/cli/next-start.js": 'const c = require("../server/config");\nexports.run = () => c.default("phase-production-server", process.cwd()).then((x) => console.log("serving " + x.distDir), (e) => { console.error(e.message); process.exit(1); });\n',
  "dist/build/index.js": BUILD_JS,
  "dist/server/config.js": CONFIG_JS,
};

// Writes the package into <nextDir>; overrides replace files by relative path.
export function writeFakeNext(nextDir, overrides = {}) {
  for (const [rel, text] of Object.entries({ ...FILES, ...overrides })) {
    const f = join(nextDir, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
}
