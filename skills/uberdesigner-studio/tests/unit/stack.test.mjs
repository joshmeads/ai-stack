// Which sites the setup scripts take on (runtime/server/adapters.ts stackSupport), and that an unsupported or
// mistaken setup changes nothing in the site (U1, U2).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stackSupport } from "../../runtime/server/adapters.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const site = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "design-map-stack-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), typeof text === "string" ? text : JSON.stringify(text));
  }
  return dir;
};
const pkg = (deps) => ({ name: "site", dependencies: deps });
const script = (name, ...args) => spawnSync(process.execPath, [join(REPO, "scripts", name), ...args], { encoding: "utf8", env: { ...process.env, DESIGN_MAP_FORCE: "" } });
const PAGE = `<!doctype html><html><head><style>:root { --ink: #111111; }</style></head><body><section class="hero"><h1>Hello there</h1></section></body></html>\n`;
const MAP = (targets) => ({
  version: 1, name: "site", facts: [], tokensFile: "index.html", extraFiles: [], groups: ["Page"], tokens: { "--ink": { kind: "color", role: "Text", label: "Ink" } },
  parts: [{ id: "hero", label: "Hero", group: "Page", prompt: [], tokens: ["--ink"], files: ["index.html"], edit: ["index.html"], targets }],
});

test("supported: Vite + React with a config, and pages with no build step", () => {
  assert.equal(stackSupport(site({ "package.json": pkg({ vite: "8", react: "19" }), "vite.config.ts": "" })).adapter?.id, "vite-react");
  assert.equal(stackSupport(site({ "index.html": PAGE })).adapter?.id, "html-static");
  assert.equal(stackSupport(site({ "public/index.html": PAGE, "server.js": "require('http').createServer().listen(3000)" })).adapter?.id, "html-server");
});

test("not supported, and said by name", () => {
  const no = (files) => {
    const s = stackSupport(site(files));
    assert.equal(s.ok, false);
    return s.found;
  };
  assert.equal(no({ "package.json": pkg({ next: "16", react: "19" }) }), "Next.js");
  assert.equal(no({ "package.json": pkg({ next: "16", react: "19", vite: "8" }), "vite.config.ts": "" }), "Next.js"); // Vite there for its tests
  assert.equal(no({ "package.json": pkg({ astro: "5" }) }), "Astro");
  assert.equal(no({ "package.json": pkg({ vite: "8", vue: "3" }), "vite.config.ts": "" }), "Vite + Vue");
  assert.equal(no({ "package.json": pkg({ vite: "8" }), "vite.config.ts": "" }), "Vite without React");
  assert.equal(no({ "package.json": pkg({ vite: "8", react: "19" }) }), "Vite + React, no config");
  assert.equal(no({ "package.json": pkg({ webpack: "5" }), "index.html": PAGE }), "webpack");
  assert.equal(no({ "package.json": pkg({ express: "5" }) }), "a package.json with no known build tool");
});

test("index and apply stop on a Next.js site and change nothing", () => {
  const dir = site({ "package.json": pkg({ next: "16", react: "19" }), "app/page.tsx": "export default function Page() { return <main /> }" });
  const before = readdirSync(dir).sort().join();
  const map = join(site({ "map.json": MAP([]) }), "map.json");
  for (const r of [script("index.mjs", dir), script("apply.mjs", dir, map), script("verify.mjs", dir)]) {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Not supported yet: this is a Next\.js site/);
  }
  assert.equal(readdirSync(dir).sort().join(), before); // no .inspector/, no map, no .gitignore
});

test("apply with a mistake in the map leaves the site as it was", () => {
  const dir = site({ "index.html": PAGE });
  const run = (targets) => script("apply.mjs", dir, join(site({ "map.json": MAP(targets) }), "map.json"));
  // a target in a file apply doesn't have
  let r = run([{ file: "pages/about.html", find: 'class="hero"' }]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pages\/about\.html.*doesn't exist/);
  // a find that matches nothing: found only after the tagging has been worked out
  r = run([{ file: "index.html", find: 'class="nothing-like-this"' }]);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(dir, "index.html"), "utf8"), PAGE);
  assert.ok(!existsSync(join(dir, ".inspector", "tool")));
  assert.ok(!existsSync(join(dir, "inspector.map.json")));
  assert.ok(!existsSync(join(dir, ".gitignore")));
  // and the same map, corrected, installs
  r = run([{ file: "index.html", find: 'class="hero"' }]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, "index.html"), "utf8"), /<section data-dm="hero" class="hero">/);
  assert.ok(existsSync(join(dir, ".inspector", "tool", "server", "guard.ts")));
  assert.ok(existsSync(join(dir, "inspector.map.json")));
});
