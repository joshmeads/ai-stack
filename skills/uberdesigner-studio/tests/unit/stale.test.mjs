// Which writes mark the open page as needing a reload (runtime/server/site.ts wroteOnPurpose). On a stack whose dev
// server swaps changed modules into the page, code the inspector wrote on purpose does: a loop a component already
// started keeps its old values although the dev server reports the update as done. A site served by serve.ts is
// judged file by file by its own watcher instead.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { detectStack } from "../../runtime/server/adapters.ts";
import * as site from "../../runtime/server/site.ts";

const folder = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "design-map-stale-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};
const VITE = folder({ "package.json": JSON.stringify({ devDependencies: { vite: "^8.0.0" }, dependencies: { react: "^19.0.0" } }) });
const HTML = folder({ "index.html": "<!doctype html><title>Page</title><p>Hello</p>" });

test("only the Vite stack swaps modules into the open page", () => {
  assert.equal(detectStack(VITE).hotUpdates, true);
  assert.equal(detectStack(HTML).hotUpdates, false);
});

test("code written on purpose on a hot-update stack marks the page stale; stylesheets and the map don't", () => {
  site.useRoot(VITE);
  const before = site.stale;
  site.wroteOnPurpose(["src/styles/tokens.css", "src/components/Ring.module.css", "inspector.map.json"]);
  assert.equal(site.stale, before, "a stylesheet shows at once: nothing to reload for");
  site.wroteOnPurpose(["src/components/Ring.tsx", "src/components/Ring.module.css", "inspector.map.json"]);
  assert.deepEqual(site.stale?.files, ["src/components/Ring.tsx"]);
});

test("a site served by serve.ts is left to its own watcher", () => {
  site.useRoot(HTML);
  const before = site.stale;
  site.wroteOnPurpose(["main.js", "index.html"]);
  assert.equal(site.stale, before);
});
