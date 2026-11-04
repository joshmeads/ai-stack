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
  const out = path.join(dir, config.distDir);
  await fs.promises.mkdir(out, { recursive: true });
  for (const e of fs.readdirSync(out)) if (e !== "cache") fs.rmSync(path.join(out, e), { recursive: true, force: true });
  if (process.env.FAKE_SCENARIO === "install") {
    await require("../lib/install-dependencies.js").installDependencies(dir, [{ pkg: "typescript" }], true);
  }
  const ts = path.join(dir, config.typescript?.tsconfigPath || "tsconfig.json");
  if (!fs.existsSync(ts)) fs.writeFileSync(ts, "{}\\n");
  const t = JSON.parse(fs.readFileSync(ts, "utf8"));
  t.include = [...(t.include ?? []), config.distDir + "/types/**/*.ts"];
  fs.writeFileSync(ts, JSON.stringify(t, null, 2) + "\\n");
  await fs.promises.writeFile(path.join(dir, "next-env.d.ts"), 'import "./' + config.distDir + '/types/routes.d.ts";\\n');
  for (const d of ["server", "static"]) {
    fs.mkdirSync(path.join(out, d), { recursive: true });
    fs.writeFileSync(path.join(out, d, "a.js.map"), "{}");
  }
  fs.writeFileSync(path.join(out, "BUILD_ID"), String(Date.now()));
};
`;

const INSTALL_DEPS_JS = `"use strict";
const _install = require("./helpers/install");
exports.installDependencies = async (dir, deps, dev) => _install.install(dir, deps.map((d) => d.pkg), { devDependencies: dev });
`;

const INSTALL_JS = `"use strict";
Object.defineProperty(exports, "install", { enumerable: true, get: function() { return install; } });
function install(root, deps) {
  require("fs").writeFileSync(require("path").join(root, "package.json"), JSON.stringify({ devDependencies: deps }));
  return Promise.resolve();
}
`;

const FILES = {
  "package.json": '{ "name": "next", "version": "0.0.0-fake" }\n',
  "dist/bin/next": "const [sub, ...rest] = process.argv.slice(2);\nimport(`../cli/next-${sub}.js`).then((m) => m.run(rest));\n",
  "dist/cli/next-build.js": 'const b = require("../build/index.js");\nexports.run = () => b.default(process.cwd()).catch((e) => { console.error(e.message); process.exit(1); });\n',
  "dist/cli/next-start.js": 'const s = require("../server/lib/start-server.js");\nexports.run = () => s.start(process.cwd()).then((x) => console.log("serving " + x.distDir), (e) => { console.error(e.message); process.exit(1); });\n',
  "dist/server/lib/start-server.js": 'const c = require("../config");\nexports.start = (dir) => c.default("phase-production-server", dir);\n',
  "dist/build/index.js": BUILD_JS,
  "dist/server/config.js": CONFIG_JS,
  "dist/lib/install-dependencies.js": INSTALL_DEPS_JS,
  "dist/lib/helpers/install.js": INSTALL_JS,
};

export function writeFakeNext(nextDir, overrides = {}) {
  for (const [rel, text] of Object.entries({ ...FILES, ...overrides })) {
    const f = join(nextDir, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
}
