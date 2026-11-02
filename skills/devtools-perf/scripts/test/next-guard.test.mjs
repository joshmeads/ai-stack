// `cdt next build` against a fake Next in a temp git repo: Next's writes are
// undone, later edits survive, a killed run is finished by the next one, and
// a project left pointing at cdt-profile with no record is refused.
// Run: node --test skills/devtools-perf/scripts/test/

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import guard from "../lib/next-guard.cjs";
import { writeFakeNext } from "./fake-next.mjs";

const CDT = fileURLToPath(new URL("../cdt.mjs", import.meta.url));
const TSCONFIG = '{\n    "compilerOptions": {}\n}\n'; // a layout Next's rewrite changes

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cdt-guard-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "app");
  writeFakeNext(join(app, "node_modules", "next"));
  writeFileSync(join(root, ".gitignore"), "node_modules\n.next\n");
  writeFileSync(join(app, "tsconfig.json"), TSCONFIG);
  mkdirSync(join(app, ".next"));
  writeFileSync(join(app, ".next", "BUILD_ID"), "users-own-build");
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return app;
}

const build = (app, scenario) => {
  const r = spawnSync(process.execPath, [CDT, "next", "build", "--dir", app], { env: { ...process.env, FAKE_SCENARIO: scenario ?? "" }, encoding: "utf8" });
  return { ...r, text: r.stdout + r.stderr };
};
const read = (f) => readFileSync(f, "utf8");

test("Next's writes are undone exactly; the user's build is untouched", (t) => {
  const app = project(t);
  const r = build(app);
  assert.equal(r.status, 0, r.text);
  assert.equal(read(join(app, "tsconfig.json")), TSCONFIG);
  assert.equal(existsSync(join(app, "next-env.d.ts")), false);
  assert.equal(read(join(app, ".next", "BUILD_ID")), "users-own-build");
  assert.ok(existsSync(join(app, ".next", "cdt-profile", "BUILD_ID")));
  assert.match(r.text, /restored tsconfig\.json/);
  assert.match(r.text, /removed next-env\.d\.ts/);
});

test("an edit made after Next's write survives and is reported", (t) => {
  const app = project(t);
  const r = build(app, "edit");
  assert.match(read(join(app, "tsconfig.json")), /by hand/);
  assert.ok(existsSync(join(app, "PERF-NOTES.md")));
  assert.match(r.text, /tsconfig\.json changed again after Next wrote it/);
  assert.match(r.text, /git reports other changes.*PERF-NOTES\.md/);
  assert.equal(existsSync(join(app, "next-env.d.ts")), false, "next-env.d.ts was only Next's, so it goes");
  assert.notEqual(r.status, 0, "a project file still points at cdt-profile");
});

test("a run killed mid-build is finished by the next run", (t) => {
  const app = project(t);
  const killed = build(app, "kill");
  assert.equal(killed.signal, "SIGKILL");
  assert.match(read(join(app, "tsconfig.json")), /cdt-profile/);
  const gdir = guard.guardDir(app);
  for (let i = 0; i < 100 && guard.liveRun(gdir); i++) spawnSync("sleep", ["0.05"]);
  const r = build(app);
  assert.equal(r.status, 0, r.text);
  assert.match(r.text, /interrupted profiling build/);
  assert.equal(read(join(app, "tsconfig.json")), TSCONFIG);
  assert.equal(existsSync(join(app, "next-env.d.ts")), false);
});

test("a project already pointing at cdt-profile with no record is refused", (t) => {
  const app = project(t);
  const contaminated = '{ "include": [".next/cdt-profile/types/**/*.ts"] }\n';
  writeFileSync(join(app, "tsconfig.json"), contaminated);
  const r = build(app);
  assert.equal(r.status, 1);
  assert.match(r.text, /mentions cdt-profile/);
  assert.equal(read(join(app, "tsconfig.json")), contaminated);
  assert.equal(existsSync(join(app, ".next", "cdt-profile")), false);
});
