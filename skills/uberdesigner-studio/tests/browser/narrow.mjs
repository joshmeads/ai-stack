#!/usr/bin/env node
// The cover over an editor too narrow for its window (runtime/panel-src/inspector/NarrowCover.tsx), in a real browser,
// on the fixture site (tests/fixtures/veyl):
//   - an ordinary browser is never covered, however narrow;
//   - the Claude desktop app's own browser (told by its user agent) is, below the editor's width, with the editor's
//     own address to copy; widening the window takes the cover away, narrowing it brings it back;
//   - "Continue here anyway" takes it away for the tab, a reload included.
//   node tests/browser/narrow.mjs [--shot <file.png>]     needs Google Chrome; about 15 s
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHOT = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;
const SITE = join(mkdtempSync(join(tmpdir(), "design-map-narrow-")), "site");
cpSync(join(REPO, "tests", "fixtures", "veyl"), SITE, { recursive: true });
const applied = spawnSync(process.execPath, [join(REPO, "scripts", "apply.mjs"), SITE, join(SITE, "inspector.map.json")], { encoding: "utf8" });
if (applied.status !== 0) {
  console.error(`apply failed: ${applied.stderr}`);
  process.exit(2);
}
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const server = spawn(process.execPath, [join(SITE, ".inspector", "tool", "server", "serve.ts"), "--port", String(port)], { cwd: SITE, env: { ...process.env, CLAUDE_BIN: join(REPO, "tests", "sites", "fake-claude.mjs") }, stdio: "ignore" });
await sleep(1500);
const EDITOR = `http://localhost:${port}/__inspector/editor`;
const t = await openEditor(EDITOR);
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${String(err.message).split("\n")[0]}`);
  }
};
// The Claude desktop app's browser, as it names itself (read from the app's pane on 18 Nov 2026)
const CLAUDE_APP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/5.11492.5 Chrome/156.0.8078.75 Safari/537.36";
const width = async (w) => {
  await t.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await t.sleep(400);
};
const reload = async () => {
  await t.send("Page.navigate", { url: EDITOR });
  for (let i = 0; i < 120 && !(await t.ev(`document.querySelectorAll('button[data-layer]').length`).catch(() => 0)); i++) await sleep(250);
  await t.sleep(500);
};
const cover = () => t.ev(`(() => { const d = document.querySelector('[aria-labelledby="design-inspector-narrow"]'); return d ? { title: d.querySelector('h2').textContent, link: d.querySelector('code').textContent, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent) } : null; })()`);
const press = (label) => t.ev(`[...document.querySelectorAll('[aria-labelledby="design-inspector-narrow"] button')].find((b) => b.textContent === ${JSON.stringify(label)})?.click()`);

try {
  await width(800);
  await reload();
  const plain = await cover();
  check("an ordinary browser isn't covered at 800 px", () => assert.equal(plain, null));

  await t.send("Emulation.setUserAgentOverride", { userAgent: CLAUDE_APP });
  await reload();
  const shown = await cover();
  check("the Claude app's browser is covered at 800 px", () => assert.equal(shown?.title, "The studio needs a wider window"));
  // The editor keeps the picked layer and the size in its address, so the address starts as it was opened
  check("the cover shows the editor's own address", () => assert.ok(shown?.link.startsWith(EDITOR), shown?.link));
  check("it offers to copy the link, or to continue", () => assert.deepEqual(shown?.buttons, ["Copy link", "Continue here anyway"]));
  const behind = await t.ev(`document.querySelectorAll('button[data-layer]').length`);
  check("the editor is still there behind it", () => assert.ok(behind > 0));
  if (SHOT) {
    const shot = await t.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
  }

  await press("Copy link");
  await t.sleep(400);
  const after = await t.ev(`(() => { const d = document.querySelector('[aria-labelledby="design-inspector-narrow"]'); return { button: d.querySelector('button').textContent, note: d.querySelectorAll('p')[1].textContent }; })()`);
  // Headless Chrome may or may not hand the clipboard over: either the button says so, or the link is selected
  check("Copy link says what happened", () => assert.ok(after.button === "Link copied" || /link is selected/.test(after.note), JSON.stringify(after)));

  await width(1440);
  const wide = await cover();
  check("widening the window to 1440 px takes the cover away", () => assert.equal(wide, null));
  await width(800);
  const back = await cover();
  check("narrowing it again brings the cover back", () => assert.equal(back?.title, "The studio needs a wider window"));

  await press("Continue here anyway");
  await t.sleep(300);
  const gone = await cover();
  check("Continue here anyway takes it away", () => assert.equal(gone, null));
  await reload();
  const still = await cover();
  check("and it stays away after a reload in the same tab", () => assert.equal(still, null));
} finally {
  t.close();
  server.kill();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nnarrow: all checks passed");
process.exit(0);
