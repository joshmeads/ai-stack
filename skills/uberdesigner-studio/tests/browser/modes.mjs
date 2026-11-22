#!/usr/bin/env node
// Focus and Design, as a person meets them, in a real browser: a tiny site, the studio installed by apply.mjs, its
// own server, and a stand-in for Claude Code that returns a scripted answer (nothing is sent to Claude).
//   - a site opened for the first time is in Focus: the site, the request bar and AI changes; no layers list, no
//     Elements tab;
//   - in Focus a click on the site still picks, and a request runs and gets its card;
//   - switching to Design keeps the picked layer, the words typed in the request bar and the size, and shows the
//     layers and Elements;
//   - the mode is kept when the editor is reloaded;
//   - the logo opens the About card and Escape closes it without dropping the pick;
//   - the site's own address opens in the studio, and ?studio=off / ?studio=on switch that for the browser.
//   node tests/browser/modes.mjs        needs Google Chrome (CHROME=… for another path); about 30 s
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = mkdtempSync(join(tmpdir(), "design-map-modes-"));
const CAPTURE = mkdtempSync(join(tmpdir(), "design-map-modes-capture-"));
const TITLE = ".hero h1 { color: var(--ink); }";
writeFileSync(
  join(SITE, "index.html"),
  `<!doctype html><html><head><title>Modes</title><style>
:root { --ink: #111111; }
body { margin: 0; font-family: sans-serif; }
.hero { padding: 24px; min-height: 400px; }
${TITLE}
.foot { padding: 24px; }
</style></head><body>
<section class="hero"><h1>Hello</h1><p>Lead</p></section>
<footer class="foot"><small>Since 1962</small></footer>
</body></html>
`,
);
const part = (id, label, find) => ({ id, label, group: "Page", prompt: [{ where: "index.html", text: label }], tokens: [], files: ["index.html"], edit: ["index.html"], targets: [{ file: "index.html", find }] });
writeFileSync(join(SITE, "map.draft.json"), JSON.stringify({ version: 1, name: "Modes", facts: [], tokensFile: "index.html", extraFiles: [], groups: ["Page"], tokens: {}, parts: [part("hero", "Hero", 'class="hero"'), part("foot", "Footer", 'class="foot"')] }));
const applied = spawnSync(process.execPath, [join(REPO, "scripts", "apply.mjs"), SITE, join(SITE, "map.draft.json")], { encoding: "utf8" });
assert.equal(applied.status, 0, applied.stderr);
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const server = spawn(process.execPath, [join(SITE, ".inspector", "tool", "server", "serve.ts"), "--port", String(port)], { cwd: SITE, env: { ...process.env, CLAUDE_BIN: join(REPO, "tests", "sites", "fake-claude.mjs"), CAPTURE_DIR: CAPTURE }, stdio: "ignore" });
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
// As a person's first visit: no mode chosen yet
const t = await openEditor(`http://localhost:${port}/__inspector/editor`, { mode: null });
const press = (re) => t.ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent.trim()) && !b.disabled && b.getClientRects().length); if (!b) return false; b.click(); return true; })()`);
const look = () =>
  t.ev(`(() => {
    const shows = (el) => !!el && el.getClientRects().length > 0;
    const tabs = [...document.querySelectorAll('button[role=tab]')].filter(shows).map(b => b.textContent.trim().replace(/\\s+/g, ' '));
    return {
      mode: [...document.querySelectorAll('[aria-label="Mode"] button')].find(b => b.getAttribute('aria-checked') === 'true')?.textContent.trim() ?? null,
      layersList: shows(document.querySelector('button[data-layer]')),
      tabs,
      requestBar: shows(document.querySelector('textarea')),
      target: document.querySelector('textarea')?.getAttribute('placeholder') ?? '',
      draft: document.querySelector('textarea')?.value ?? '',
      picked: document.querySelector('[data-active="true"] button[data-layer]')?.dataset.layer ?? null,
      siteWidth: document.querySelector('iframe').contentWindow.innerWidth,
      about: shows(document.querySelector('[role=dialog][aria-labelledby="uberdesigner-about-title"]')),
      aboutLinks: [...document.querySelectorAll('[role=dialog][aria-labelledby="uberdesigner-about-title"] a')].map(a => a.getAttribute('href').split('?')[0]),
      cards: [...document.querySelectorAll('article')].filter(shows).map(a => a.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80)),
    };
  })()`);
const type = (words) => t.ev(`(() => { const a = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(a, ${JSON.stringify(words)}); a.dispatchEvent(new Event('input', { bubbles: true })); })()`);

try {
  await t.sleep(2500);
  const first = await look();
  check("a site opened for the first time is in Focus: the site, the request bar and AI changes", () => {
    assert.equal(first.mode, "Focus");
    assert.equal(first.layersList, false, "the layers list shows in Focus");
    assert.deepEqual(first.tabs.filter((x) => /Elements|Layers|Assets|History/.test(x)), [], `tabs: ${first.tabs.join(", ")}`);
    assert.ok(first.tabs.some((x) => /^AI changes/.test(x)), `tabs: ${first.tabs.join(", ")}`);
    assert.equal(first.requestBar, true);
  });

  // A real click on the hero's own space (under its words): picking works as in Design, a click picks the block
  const at = await t.fev(`(() => { const r = d.querySelector('.hero').getBoundingClientRect(); return [r.left + 200, r.bottom - 60]; })()`);
  const xy = await t.toEditor(at[0], at[1]);
  await t.click(xy[0], xy[1]);
  await t.sleep(700);
  const pickedInFocus = await look();
  writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify({ summary: "The headline is spaced. Done.", edits: [{ file: "index.html", find: TITLE, replace: ".hero h1 { color: var(--ink); letter-spacing: 2px; }" }], create: [] }));
  await type("Space the headline's letters.");
  await t.sleep(300);
  await press("/^(Run|Queue)$/");
  let done = null;
  for (let i = 0; i < 60 && !done; i++) {
    await t.sleep(300);
    done = (await t.ev(`fetch('/__inspector/jobs').then(r => r.json()).then(d => d.jobs)`)).find((j) => j.state === "done" || j.state === "error") ?? null;
  }
  await t.sleep(1200);
  const afterRun = await look();
  check("in Focus a click on the site picks, and a request runs and gets its card", () => {
    assert.equal(pickedInFocus.picked, "hero", "the click didn't pick the block");
    assert.match(pickedInFocus.target, /hero/i, `the request bar asks: ${pickedInFocus.target}`);
    assert.equal(done?.state, "done", done?.error);
    assert.ok(readFileSync(join(SITE, "index.html"), "utf8").includes("letter-spacing: 2px"), "the change isn't in the file");
    assert.ok(afterRun.cards.some((c) => c.includes("Space the headline")), `cards: ${afterRun.cards.join(" | ")}`);
  });

  await type("make it bigger");
  await t.ev(`[...document.querySelectorAll('button[role="radio"]')].find((b) => /Tablet/.test(b.textContent))?.click()`);
  await t.sleep(700);
  const beforeSwitch = await look();
  await press("/^Design$/");
  await t.sleep(900);
  const inDesign = await look();
  check("switching to Design keeps the picked layer, the typed request and the size", () => {
    assert.equal(beforeSwitch.siteWidth, 768);
    assert.equal(inDesign.mode, "Design");
    assert.equal(inDesign.layersList, true, "no layers list in Design");
    assert.ok(inDesign.tabs.some((x) => /^Elements/.test(x)) && inDesign.tabs.some((x) => /^Layers/.test(x)), `tabs: ${inDesign.tabs.join(", ")}`);
    assert.equal(inDesign.picked, "hero");
    assert.equal(inDesign.draft, "make it bigger");
    assert.equal(inDesign.siteWidth, 768);
  });

  await t.ev(`location.reload()`);
  await t.sleep(3500);
  const reloaded = await look();
  check("the mode is kept when the editor is reloaded", () => {
    assert.equal(reloaded.mode, "Design");
    assert.equal(reloaded.layersList, true);
    assert.equal(reloaded.picked, "hero");
  });

  await t.ev(`document.querySelector('button[aria-label="About uberdesigner"]').click()`);
  await t.sleep(500);
  const aboutOpen = await look();
  await t.key("Escape", "Escape", 27);
  await t.sleep(500);
  const aboutClosed = await look();
  check("the logo opens the About card; Escape closes it and the pick stays", () => {
    assert.equal(aboutOpen.about, true, "the card didn't open");
    assert.deepEqual(aboutOpen.aboutLinks, ["https://uberdesigner.ai", "https://uberdesigner.ai/library", "https://x.com/uberdesigner_ai", "https://github.com/bogdan239/uberdesigner-studio", "https://discord.gg/CuyTccfBg3"]);
    assert.equal(aboutClosed.about, false, "Escape didn't close it");
    assert.equal(aboutClosed.picked, "hero", "closing the card dropped the pick");
  });

  await press("/^Focus$/");
  await t.sleep(700);
  const backInFocus = await look();
  check("back in Focus the layers and Elements are gone again, the pick stays", () => {
    assert.equal(backInFocus.layersList, false);
    assert.equal(backInFocus.tabs.some((x) => /^Elements/.test(x)), false);
    assert.match(backInFocus.target, /hero/i);
  });
  // The site's own address opens in the studio; ?studio=off gives this browser the plain site until ?studio=on
  const where = () => t.ev(`({ path: location.pathname, site: new URLSearchParams(location.search).get('path'), studio: !!document.getElementById('design-inspector'), words: document.querySelector('h1')?.textContent ?? null })`);
  const go = async (url) => {
    await t.send("Page.navigate", { url: `http://localhost:${port}${url}` });
    await t.sleep(2500);
    return where();
  };
  const arrived = await go("/");
  const off = await go("/?studio=off");
  const stillOff = await go("/");
  const on = await go("/?studio=on");
  check("the site's address opens in the studio; ?studio=off gives the plain site until ?studio=on", () => {
    assert.deepEqual([arrived.path, arrived.site, arrived.studio], ["/__inspector/editor", "/", true]);
    assert.deepEqual([off.path, off.studio, off.words], ["/", false, "Hello"], "?studio=off didn't give the plain site");
    assert.deepEqual([stillOff.path, stillOff.studio], ["/", false], "the plain site didn't hold for the next page");
    assert.deepEqual([on.path, on.site, on.studio], ["/__inspector/editor", "/", true], "?studio=on didn't bring the studio back");
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
