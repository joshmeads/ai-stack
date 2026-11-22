#!/usr/bin/env node
// Layer identity in a real browser (step 1): the page is asked for each layer in one place (panel resolve.ts), so this
// checks what only a browser can show. A tiny site is built in a temporary folder with every kind of layer:
//   - tagged in the code (Hero, Features, the canvas);
//   - an element the site itself tags data-part, as a layer (Size M);
//   - found by a selector: a headline a script renders, and renders again every 2 s (Features title);
//   - a selector that matches nothing (Lost badge), and a piece with no element at all (Spark);
// and a second page that carries none of them. The inspector is installed by apply.mjs and served by its own server.
//   node tests/browser/identity.mjs        needs Google Chrome (CHROME=… for another path); about 30 s
// Exit code 1 if any check fails. Nothing is sent to Claude.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = mkdtempSync(join(tmpdir(), "design-map-identity-"));
writeFileSync(
  join(SITE, "index.html"),
  `<!doctype html><html><head><title>Ident</title><style>
:root { --ink: #111111; --title-size: 40px; --accent: #cc3300; }
body { margin: 0; font-family: sans-serif; color: var(--ink); }
.hero, .features { padding: 80px 40px; }
.features { min-height: 400px; }
.features h2 { font-size: var(--title-size); color: var(--ink); margin: 0; }
.sizes button { padding: 12px 20px; }
canvas { width: 200px; height: 100px; display: block; }
</style></head><body>
<section class="hero"><h1>Hello there</h1><div class="sizes"><button class="size" data-part="small">S</button><button class="size" data-part="medium">M</button></div></section>
<section class="features"><div class="split" style="display: contents"></div><canvas class="scene"></canvas></section>
<script>
// a "component" that renders its own h2, and renders it again (a new element) every 2 s
const host = document.querySelector(".split");
const render = () => { host.innerHTML = "<h2>Small rituals, deep rest</h2>"; };
setTimeout(render, 300); setInterval(render, 2000);
document.querySelectorAll("[data-part]").forEach((b) => b.addEventListener("click", () => {}));
</script></body></html>
`,
);
writeFileSync(join(SITE, "other.html"), `<!doctype html><html><head><title>Other</title></head><body><main><p>A page the map doesn't describe.</p></main></body></html>\n`);
const part = (id, label, more) => ({ id, label, group: "Page", prompt: [{ where: "index.html", text: label }], tokens: [], files: ["index.html"], edit: ["index.html"], ...more });
const MAP = {
  version: 1, name: "Ident", facts: ["Everything is in index.html."], tokensFile: "index.html", extraFiles: [], groups: ["Page"],
  tokens: { "--ink": { kind: "color", role: "Text colour", label: "Text colour" }, "--title-size": { kind: "size", role: "Title size", label: "Title size" }, "--accent": { kind: "color", role: "Accent", label: "Accent colour" } },
  parts: [
    part("hero", "Hero", { tokens: ["--ink"], targets: [{ file: "index.html", find: 'class="hero"' }] }),
    part("size-medium", "Size M", { parent: "hero", targets: [{ file: "index.html", find: 'data-part="medium"' }] }),
    part("features", "Features", { targets: [{ file: "index.html", find: 'class="features"' }] }),
    part("features-title", "Features title", { parent: "features", tokens: ["--title-size", "--ink"], targets: [{ selector: "[data-dm='features'] h2" }] }),
    part("scene", "Scene", { parent: "features", kind: "scene", targets: [{ file: "index.html", find: 'class="scene"' }] }),
    part("spark", "Spark", { parent: "scene", outline: false, tokens: ["--accent"] }),
    part("lost", "Lost badge", { parent: "features", tokens: ["--ink"], targets: [{ selector: "[data-dm='features'] .nothing-here" }] }),
  ],
};
writeFileSync(join(SITE, "map.draft.json"), JSON.stringify(MAP));
const applied = spawnSync(process.execPath, [join(REPO, "scripts", "apply.mjs"), SITE, join(SITE, "map.draft.json")], { encoding: "utf8" });
assert.equal(applied.status, 0, applied.stderr);

const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const server = spawn(process.execPath, [join(SITE, ".inspector", "tool", "server", "serve.ts"), "--port", String(port)], { cwd: SITE, stdio: "ignore" });
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
const rows = (t) => t.ev(`Object.fromEntries([...document.querySelectorAll('button[data-layer]')].map(b => [b.dataset.layer, b.textContent.trim()]))`);
const picked = (t) => t.ev(`JSON.parse(localStorage.getItem('design-inspector:editor:Ident') ?? '{}').selected ?? null`);
const pick = async (t, id) => {
  await t.ev(`document.querySelector('button[data-layer="${id}"]')?.click()`);
  await t.sleep(900);
};
const panel = (t) => t.ev(`(() => { const a = document.querySelector('aside:last-of-type'); return { heads: [...a.querySelectorAll('h3')].map(h => h.textContent.trim()), notes: [...a.querySelectorAll('p')].map(p => p.textContent.trim()).filter(x => /page|element/.test(x)).join(' '), numbers: a.querySelectorAll('input[type=number]').length }; })()`);
const clickSite = async (t, expr) => {
  const at = await t.fev(`(() => { const e = ${expr}; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
  const [x, y] = await t.toEditor(at[0], at[1]);
  await t.click(x, y);
  await t.sleep(700);
};

let t = await openEditor(`http://localhost:${port}/__inspector/editor`);
try {
  await t.sleep(3500);
  const list = await rows(t);
  check("a layer whose selector matches nothing is marked, the others aren't", () => {
    assert.match(list.lost, /not on page$/);
    for (const id of ["hero", "size-medium", "features", "features-title", "scene"]) assert.doesNotMatch(list[id], /not on page|hidden/, id);
  });
  const marks = await t.fev(`[...d.querySelectorAll('[data-dm]')].map(e => e.tagName.toLowerCase() + ':' + e.getAttribute('data-dm'))`);
  check("the page carries one mark per layer: tags from the code, and the selector's element", () => assert.deepEqual(marks, ["section:hero", "button:size-medium", "section:features", "h2:features-title", "canvas:scene"]));
  check("nothing was written into the code for the selector layers", () => assert.doesNotMatch(readFileSync(join(SITE, "index.html"), "utf8"), /data-dm="(features-title|lost)"/));

  // The site draws the headline again every 2 s: how long a new element waits for its mark
  const waits = await t.ev(`new Promise((done) => { const d = document.querySelector('iframe').contentWindow.document; let last = null; let since = 0; const waits = []; const t0 = performance.now(); const tick = () => { const h = d.querySelector('h2'); if (h && h !== last) { last = h; since = performance.now(); } if (h && since && h.hasAttribute('data-dm')) { waits.push(Math.round(performance.now() - since)); since = 0; } performance.now() - t0 < 4500 ? setTimeout(tick, 4) : done(waits); }; tick(); })`);
  check(`an element the site draws again is marked again within a few frames (waited ${waits.join(", ")} ms)`, () => {
    assert.ok(waits.length >= 2);
    assert.ok(Math.max(...waits) <= 100);
  });

  await clickSite(t, `d.querySelector('h2')`);
  const onTitle = await picked(t);
  check("a click on the headline picks its own layer, not the section around it (MOOR-H1)", () => assert.equal(onTitle, "features-title"));
  await clickSite(t, `d.querySelector('[data-part="medium"]')`);
  const onButton = await picked(t);
  check("a click on an element the site tags data-part picks its layer (UI-1)", () => assert.equal(onButton, "size-medium"));

  await pick(t, "features-title");
  const titlePanel = await panel(t);
  check("a selector layer offers its own values", () => {
    assert.deepEqual(titlePanel.heads, ["Features title only"]);
    assert.ok(titlePanel.numbers >= 1);
  });
  await t.ev(`(() => { const i = document.querySelector('aside:last-of-type input[type=number]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '72'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.sleep(500);
  const live = await t.fev(`w.getComputedStyle(d.querySelector('h2')).fontSize`);
  await t.sleep(2300);
  const liveLater = await t.fev(`w.getComputedStyle(d.querySelector('h2')).fontSize`);
  check("a live value shows on the element, and still does after the site draws it again", () => {
    assert.equal(live, "72px");
    assert.equal(liveLater, "72px");
  });
  await t.ev(`[...document.querySelectorAll('button')].find(b => /^Save$/.test(b.textContent.trim()) && !b.disabled)?.click()`);
  await t.sleep(3000);
  const saved = readFileSync(join(SITE, "index.html"), "utf8");
  const after = await t.fev(`w.getComputedStyle(d.querySelector('h2')).fontSize`);
  check("its value is saved under the selector, and the page shows it from the file", () => {
    assert.match(saved, /\[data-dm="features"\] h2 \{\n  --title-size: 72px;\n\}/);
    assert.equal(after, "72px");
  });

  await pick(t, "lost");
  const lostStatus = await t.status();
  const lostPanel = await panel(t);
  check("a layer the page doesn't carry says why, and offers no values (UI-10)", () => {
    assert.match(lostStatus, /Nothing on this page matches the address of Lost badge/);
    assert.equal(lostPanel.numbers, 0);
    assert.deepEqual(lostPanel.heads, []);
    assert.match(lostPanel.notes, /a value saved for it now would change nothing/);
  });
  await pick(t, "spark");
  const sparkPanel = await panel(t);
  check("a piece with no element offers no values of its own, and says where they are", () => {
    assert.deepEqual(sparkPanel.heads, []);
    assert.match(sparkPanel.notes, /Spark has no element of its own on the page.*change them under Whole site/);
  });
} finally {
  t.close();
}

t = await openEditor(`http://localhost:${port}/__inspector/editor?path=${encodeURIComponent("/other.html")}`);
try {
  await t.sleep(3500);
  const other = await t.ev(`({ banner: [...document.querySelectorAll('[role=status]')].map(x => x.textContent.trim().replace(/\\s+/g, ' ')).join(' '), chips: [...document.querySelectorAll('button[data-layer]')].map(b => b.textContent.trim()).join(' | ') })`);
  check("a page with none of the map's layers says so, and doesn't mark every layer (F12)", () => {
    assert.match(other.banner, /This page carries none of the map's layers.*its layers are tagged in index\.html/);
    assert.doesNotMatch(other.chips, /hidden|not on page/);
  });
} finally {
  t.close();
  server.kill();
}
console.log(failed.length ? `\n${failed.length} check(s) failed. The site: ${SITE}` : "\nall checks passed");
process.exit(failed.length ? 1 : 0);
