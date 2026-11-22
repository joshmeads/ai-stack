#!/usr/bin/env node
// Preview, as a person uses it, in a real browser: a tiny two-page site, the studio installed by apply.mjs, its own
// server (nothing is sent to Claude).
//   - Preview shows the site alone: the editor's columns and toolbar step aside, the frame fills the window at full
//     size, nothing of the editor is drawn over the site, and Back to editor is there;
//   - Escape comes back to the editor as it was: the same layer picked, the same device size;
//   - in Preview a click goes to the site: a link opens the site's second page;
//   - the size menu gives the site a phone's width;
//   - Back to editor comes back on the page the site is on now.
//   node tests/browser/preview.mjs        needs Google Chrome (CHROME=… for another path); about 25 s
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = mkdtempSync(join(tmpdir(), "design-map-preview-"));
const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
body { margin: 0; font-family: sans-serif; }
.top { display: flex; gap: 24px; padding: 24px; }
.hero { padding: 48px 24px; min-height: 1400px; }
</style></head><body>
<header class="top"><strong>Preview site</strong><a id="to-about" href="/about.html">About us</a><a href="/">Home</a></header>
${body}
</body></html>
`;
writeFileSync(join(SITE, "index.html"), page("Home", `<section class="hero"><h1>Hello</h1><p>Lead</p></section>`));
writeFileSync(join(SITE, "about.html"), page("About", `<section class="hero"><h1>About us</h1></section>`));
const part = (id, label, find) => ({ id, label, group: "Page", prompt: [{ where: "index.html", text: label }], tokens: [], files: ["index.html"], edit: ["index.html"], targets: [{ file: "index.html", find }] });
writeFileSync(join(SITE, "map.draft.json"), JSON.stringify({ version: 1, name: "Preview", facts: [], tokensFile: "index.html", extraFiles: [], groups: ["Page"], tokens: {}, parts: [part("top", "Header", 'class="top"'), part("hero", "Hero", 'class="hero"')] }));
const applied = spawnSync(process.execPath, [join(REPO, "scripts", "apply.mjs"), SITE, join(SITE, "map.draft.json")], { encoding: "utf8" });
assert.equal(applied.status, 0, applied.stderr);
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const server = spawn(process.execPath, [join(SITE, ".inspector", "tool", "server", "serve.ts"), "--port", String(port)], { cwd: SITE, env: { ...process.env, CLAUDE_BIN: join(REPO, "tests", "sites", "fake-claude.mjs") }, stdio: "ignore" });
await sleep(1500);

const failed = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed.push(name);
    console.log(`FAIL  ${name}\n      ${String(err.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
};
const t = await openEditor(`http://localhost:${port}/__inspector/editor`);
const press = (re) => t.ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent.trim()) && !b.disabled && b.getClientRects().length); if (!b) return false; b.click(); return true; })()`);
// What a person would see of the editor right now
const look = () =>
  t.ev(`(() => {
    const frame = document.querySelector('iframe');
    const stage = frame.parentElement.parentElement.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const shows = (el) => !!el && el.getClientRects().length > 0;
    return {
      columns: [...document.querySelectorAll('aside')].filter(shows).length,
      back: [...document.querySelectorAll('button')].some(b => /^Back to editor/.test(b.textContent.trim()) && shows(b)),
      previewButton: [...document.querySelectorAll('button')].some(b => /^Preview/.test(b.textContent.trim()) && shows(b)),
      chat: shows(document.querySelector('textarea')),
      siteWidth: frame.contentWindow.innerWidth,
      siteHeight: frame.contentWindow.innerHeight,
      frame: [Math.round(f.left), Math.round(f.top), Math.round(f.width), Math.round(f.height)],
      stage: [Math.round(stage.left), Math.round(stage.top), Math.round(stage.width), Math.round(stage.height)],
      win: [innerWidth, innerHeight],
      picked: document.querySelector('[data-active="true"] button[data-layer]')?.dataset.layer ?? null,
      drawn: [...document.querySelectorAll('[data-state]')].filter(el => shows(el) && frame.parentElement.contains(el)).length,
      path: frame.contentWindow.location.pathname,
      address: new URLSearchParams(location.search).get('path'),
    };
  })()`);

try {
  await t.sleep(2500);
  await t.ev(`document.querySelector('button[data-layer="hero"]').click()`);
  await t.sleep(600);
  const before = await look();
  await press("/^Preview/");
  await t.sleep(900);
  const inPreview = await look();
  check("Preview shows the site alone, at the full size of the window", () => {
    assert.equal(before.picked, "hero", "the layer wasn't picked to begin with");
    assert.equal(before.siteWidth, 1440);
    assert.equal(inPreview.columns, 0, "the editor's columns are still there");
    assert.equal(inPreview.previewButton, false, "the toolbar is still there");
    assert.equal(inPreview.chat, false, "the request bar is still there");
    assert.equal(inPreview.back, true, "no Back to editor button");
    assert.equal(inPreview.siteWidth, inPreview.win[0], `the site is ${inPreview.siteWidth} px wide in a ${inPreview.win[0]} px window`);
    assert.equal(inPreview.frame[2], inPreview.stage[2], "the frame isn't as wide as the space it has");
    assert.equal(inPreview.frame[3], inPreview.stage[3], "the frame isn't as tall as the space it has");
    assert.equal(inPreview.drawn, 0, "something of the editor is drawn over the site");
  });

  await t.key("Escape", "Escape", 27);
  await t.sleep(900);
  const afterEscape = await look();
  check("Escape comes back to the editor as it was: the same layer, the same size", () => {
    assert.equal(afterEscape.columns, 2);
    assert.equal(afterEscape.previewButton, true);
    assert.equal(afterEscape.picked, "hero");
    assert.equal(afterEscape.siteWidth, 1440);
    assert.equal(afterEscape.back, false);
  });

  await press("/^Preview/");
  await t.sleep(900);
  // A real click where the site's link is: in Preview the mouse belongs to the site
  const link = await t.fev(`(() => { const r = d.getElementById('to-about').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const at = await t.toEditor(link[0], link[1]);
  await t.click(at[0], at[1]);
  await t.sleep(1800);
  const onAbout = await look();
  check("in Preview a click goes to the site: its link opens the second page", () => {
    assert.equal(onAbout.path, "/about.html");
    assert.equal(onAbout.back, true, "the preview ended when the page changed");
    assert.equal(onAbout.columns, 0);
  });

  await t.ev(`(() => { const s = document.querySelector('select[aria-label="Preview size"]'); s.value = 'phone'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await t.sleep(900);
  const phone = await look();
  check("the size menu gives the site a phone's width", () => {
    assert.equal(phone.siteWidth, 390);
    assert.equal(phone.path, "/about.html");
  });

  await press("/^Back to editor/");
  await t.sleep(900);
  const back = await look();
  check("Back to editor comes back on the page the site is on now", () => {
    assert.equal(back.columns, 2);
    assert.equal(back.path, "/about.html");
    assert.equal(back.address, "/about.html");
    assert.equal(back.siteWidth, 1440, "the editor's own size wasn't kept");
  });
} finally {
  t.close();
  server.kill();
}
if (failed.length) {
  console.log(`\n${failed.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
