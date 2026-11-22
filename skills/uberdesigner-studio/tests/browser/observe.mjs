#!/usr/bin/env node
// Looking at the page after a change, in a real browser (step 3): the server can't see the page, so the panel does and
// tells the change's card what it shows. A tiny site, the inspector installed by apply.mjs, its own server, and a
// stand-in for Claude Code that returns a scripted answer (nothing is sent to Claude). Checks:
//   - a value no rule of the picked layer uses, and one a later rule overrides, are said so on their fields; a value
//     that drives the layer isn't;
//   - a change that only shows on phones: the card says nothing looks different at the desktop width;
//   - a change that shows: the card says nothing extra;
//   - a change that adds a layer the page doesn't draw: the card names it;
//   - a change that adds a layer: its row joins the list in the open editor and can be picked, no reload (P3);
//   - the layer tree comes from the page: a layer is listed inside the layer its element sits in whatever the map
//     says, and a change that moves a layer in the code moves its row (P1);
//   - Undo of a change that added layers: their rows leave the layer list at once, not at the next reload (P2).
//   node tests/browser/observe.mjs        needs Google Chrome (CHROME=… for another path); about 40 s
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = mkdtempSync(join(tmpdir(), "design-map-observe-"));
const CAPTURE = mkdtempSync(join(tmpdir(), "design-map-observe-capture-"));
const RULE = ".hero h1 { color: var(--accent); font-size: 48px; margin: 0; }";
const LEAD = `<p class="lead">Fresh every day.</p>`;
writeFileSync(
  join(SITE, "index.html"),
  `<!doctype html><html><head><title>Observe</title><style>
:root { --ink: #111111; --accent: #cc3300; --gap: 24px; --track: 0.02em; }
body { margin: 0; font-family: sans-serif; color: var(--ink); }
.hero { padding: var(--gap); }
h1 { letter-spacing: var(--track); }
${RULE}
.hero h1 { letter-spacing: 0; }
</style></head><body>
<section class="hero"><h1>Hello there</h1>${LEAD}</section>
</body></html>
`,
);
const part = (id, label, more) => ({ id, label, group: "Page", prompt: [{ where: "index.html", text: label }], files: ["index.html"], edit: ["index.html"], ...more });
writeFileSync(
  join(SITE, "map.draft.json"),
  JSON.stringify({
    version: 1, name: "Observe", facts: ["Everything is in index.html."], tokensFile: "index.html", extraFiles: [], groups: ["Page"],
    tokens: { "--ink": { kind: "color", role: "Text", label: "Text colour" }, "--accent": { kind: "color", role: "Accent", label: "Accent colour" }, "--gap": { kind: "size", role: "Spacing", label: "Gap" }, "--track": { kind: "em", role: "Tracking", label: "Letter spacing" } },
    parts: [
      part("hero", "Hero", { tokens: ["--gap"], targets: [{ file: "index.html", find: 'class="hero"' }] }),
      // its colour comes from --accent. --ink is listed too, but only the body's rule uses it. --track is used by a
      // rule for h1 that a later rule (.hero h1) overrides.
      part("hero-title", "Hero title", { parent: "hero", tokens: ["--accent", "--ink", "--track"], targets: [{ file: "index.html", find: "<h1" }] }),
    ],
  }),
);
const applied = spawnSync(process.execPath, [join(REPO, "scripts", "apply.mjs"), SITE, join(SITE, "map.draft.json")], { encoding: "utf8" });
assert.equal(applied.status, 0, applied.stderr);
const port = await new Promise((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const server = spawn(process.execPath, [join(SITE, ".inspector", "tool", "server", "serve.ts"), "--port", String(port)], {
  cwd: SITE,
  env: { ...process.env, CLAUDE_BIN: join(REPO, "tests", "sites", "fake-claude.mjs"), CAPTURE_DIR: CAPTURE },
  stdio: ["ignore", "pipe", "pipe"],
});
// What the server printed and how it ended, shown when the test fails: a server that stops mid-test otherwise only
// shows up here as "Failed to fetch"
let serverSaid = "";
let serverEnded = null;
for (const stream of [server.stdout, server.stderr]) stream.on("data", (c) => (serverSaid = (serverSaid + c).slice(-8000)));
server.on("exit", (code, signal) => (serverEnded = { code, signal }));
process.on("exit", (code) => {
  if (code === 0) return;
  console.log(`\nThe inspector's server: ${serverEnded ? `stopped during the test (exit code ${serverEnded.code}, signal ${serverEnded.signal})` : "still running at the end"}`);
  console.log(serverSaid.trim() ? `What it printed last:\n${serverSaid.trim()}` : "It printed nothing.");
  server.kill();
});
await sleep(1500);

const failed = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed.push(name);
    console.log(`FAIL  ${name}\n      ${String(err.message).split("\n").slice(0, 5).join("\n      ")}`);
  }
};

const t = await openEditor(`http://localhost:${port}/__inspector/editor`);
// Ask for a change the way a person does: type in the chat bar and press Run, with Claude's answer scripted
const jobsNow = () => t.ev(`fetch('/__inspector/jobs').then(r => r.json()).then(d => d.jobs)`);
const change = async (request, answer) => {
  const had = new Set((await jobsNow()).map((j) => j.id));
  writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify({ create: [], ...answer }));
  await t.ev(`(() => { const a = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(a, ${JSON.stringify(request)}); a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.sleep(300);
  await t.ev(`[...document.querySelectorAll('button')].find(b => /^(Run|Queue)$/.test(b.textContent.trim()) && !b.disabled).click()`);
  for (let i = 0; i < 100; i++) {
    await t.sleep(300);
    const j = (await jobsNow()).find((x) => !had.has(x.id));
    if (j && (j.state === "done" || j.state === "error")) {
      // a change to the page's markup needs a reload to show: press the editor's own Reload
      await t.sleep(600);
      await t.ev(`[...document.querySelectorAll('button')].find(b => /^Reload page$/.test(b.textContent.trim()))?.click()`);
      for (let k = 0; k < 40; k++) {
        await t.sleep(300);
        const seen = (await jobsNow()).find((x) => x.id === j.id);
        if (seen.observed) return seen;
      }
      return (await jobsNow()).find((x) => x.id === j.id);
    }
  }
  throw new Error("the change never finished");
};
try {
  await t.sleep(3000);
  await t.ev(`document.querySelector('button[data-layer="hero-title"]').click()`);
  await t.sleep(1800);
  const fields = await t.ev(`[...document.querySelectorAll('aside:last-of-type [data-changed]')].map(f => ({ text: f.textContent.replace(/\\s+/g, ' ').trim() }))`);
  check("a value no rule of the layer uses, and one a later rule overrides, say so; one that drives it doesn't", () => {
    const ink = fields.find((f) => /^Text colour/.test(f.text));
    const accent = fields.find((f) => /^Accent colour/.test(f.text));
    const track = fields.find((f) => /^Letter spacing/.test(f.text));
    assert.ok(ink && accent && track, JSON.stringify(fields));
    assert.match(ink.text, /No rule on Hero title or inside it uses this value, so changing it here shows nothing/);
    assert.match(track.text, /A rule of Hero title uses this value, but changing it moves nothing at this size: a later rule sets the same thing/);
    assert.doesNotMatch(accent.text, /changing it/);
  });
  const colour = await t.fev(`w.getComputedStyle(d.querySelector('h1')).color + ' ' + d.querySelector('h1').getAttribute('style')`);
  check("asking the page left it as it was", () => assert.equal(colour, "rgb(204, 51, 0) null"));

  const phone = await change("On phones, space the letters out a little.", { summary: "Wider letter spacing on phones.", edits: [{ file: "index.html", find: RULE, replace: `${RULE}\n@media (max-width: 600px) { .hero h1 { letter-spacing: 2px; } }` }] });
  check("a change that only shows on phones: the card says nothing looks different at this width", () => {
    assert.equal(phone.state, "done", phone.error);
    assert.match(phone.observed?.note ?? "(no report)", /^Nothing on Hero title looks different at 1440 px \(hover, motion and anything drawn in a canvas aren't checked\)\.$/);
  });
  await t.sleep(1200);
  const cardText = await t.ev(`document.querySelector('aside:last-of-type').textContent.replace(/\\s+/g, ' ')`);
  check("and the card shows it next to Claude's own words", () => assert.match(cardText, /Wider letter spacing on phones\..*Nothing on Hero title looks different at 1440 px/));

  const bigger = await change("Make the headline bigger.", { summary: "Bigger headline.", edits: [{ file: "index.html", find: "font-size: 48px;", replace: "font-size: 64px;" }] });
  check("a change that shows gets no such line", () => {
    assert.equal(bigger.state, "done", bigger.error);
    assert.equal(bigger.observed?.note, "");
  });

  // A change that adds a layer the page does draw (the tester's P3): its row joins the list in this same editor
  const ribbon = await change("Add a ribbon under the lead.", {
    summary: "Added a ribbon.",
    edits: [{ file: "index.html", find: LEAD, replace: `${LEAD}<p data-dm="ribbon">Since 1962</p>` }],
    map: { add: [{ id: "ribbon", label: "Ribbon", parent: "hero-title" }], remove: [] }, // the map is told "inside the title"; the page has it beside it
  });
  await t.sleep(3000);
  const ribbonRow = await t.ev(`document.querySelector('button[data-layer="ribbon"]')?.textContent.trim() ?? null`);
  const reloadOffered = await t.ev(`[...document.querySelectorAll('button')].some(b => /Reload layers/.test(b.textContent))`);
  await t.ev(`document.querySelector('button[data-layer="ribbon"]')?.click()`);
  await t.sleep(1200);
  await t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /^Elements$/.test(b.textContent.trim()))?.click()`); // a change opens AI changes
  await t.sleep(300);
  const ribbonPicked = await t.ev(`[...document.querySelectorAll('h2,h3')].map(h => h.textContent.trim())[0] ?? ''`);
  const ribbonSaid = await t.status();
  check("a layer a change adds joins the list at once, with no reload of the editor, and can be picked (P3)", () => {
    assert.equal(ribbon.state, "done", ribbon.error);
    assert.match(ribbonRow ?? "(no row)", /Ribbon/);
    assert.equal(reloadOffered, false, '"Reload layers" is offered');
    assert.equal(ribbonPicked, "Ribbon");
    assert.doesNotMatch(ribbonSaid, /isn.t|not on/, `the footer says: ${ribbonSaid}`);
  });

  // The tree is read from the page: nesting whatever the map says, and order as the code has it now (P1)
  const depthOf = (id) => t.ev(`document.querySelector('button[data-layer="${id}"]')?.closest('[style*="--depth"]')?.style.getPropertyValue('--depth') ?? null`);
  const orderNow = () => t.ev(`[...document.querySelectorAll('button[data-layer]')].map(b => b.dataset.layer).filter(id => id === 'ribbon' || id === 'hero-title').join(' ')`);
  const depths = [await depthOf("hero-title"), await depthOf("ribbon")];
  const orderBefore = await orderNow();
  const moved = await change("Move the ribbon above the headline.", {
    summary: "Moved the ribbon up.",
    edits: [
      { file: "index.html", find: `<p data-dm="ribbon">Since 1962</p>`, replace: "" },
      { file: "index.html", find: "<h1", replace: `<p data-dm="ribbon">Since 1962</p><h1` },
    ],
  });
  await t.sleep(3000);
  const orderAfter = await orderNow();
  check("a layer is listed inside the layer its element sits in, whatever the map says", () => {
    assert.ok(depths[0] !== null && depths[1] !== null, `depths: ${depths}`);
    assert.equal(depths[1], depths[0], "the ribbon is listed inside the title, as the map said, though the page has it beside it");
  });
  check("the list follows the order of the page when a change moves a layer (P1)", () => {
    assert.equal(moved.state, "done", moved.error);
    assert.equal(orderBefore, "hero-title ribbon");
    assert.equal(orderAfter, "ribbon hero-title");
  });

  const badge = await change("Add a badge after the lead.", {
    summary: "Added a badge.",
    edits: [{ file: "index.html", find: LEAD, replace: `${LEAD}<template><em data-dm="badge">New</em></template>` }],
    map: { add: [{ id: "badge", label: "Badge", parent: "hero-title" }], remove: [] },
  });
  check("a new layer the page doesn't draw is named on the card", () => {
    assert.equal(badge.state, "done", badge.error);
    assert.deepEqual(badge.added, ["badge"]);
    assert.match(badge.observed?.note ?? "(no report)", /The new layer badge isn't on the page now/);
  });
} finally {
  t.close();
}

// Undo of a change that added layers (the tester's P2): the rows must go with the code, without a reload
const t2 = await openEditor(`http://localhost:${port}/__inspector/editor`);
const layerRows = (re) => t2.ev(`[...document.querySelectorAll('button[data-layer]')].map(b => b.dataset.layer).filter(id => ${re}.test(id)).length`);
try {
  await t2.sleep(3000);
  const hadBadge = await layerRows("/^badge$/"); // listed after the editor reloaded (the layer the last change added)
  await t2.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /changes/i.test(b.textContent))?.click()`);
  await t2.sleep(500);
  await t2.ev(`[...document.querySelectorAll('button')].find(b => /^Undo$/.test(b.textContent.trim()) && !b.disabled)?.click()`);
  await t2.sleep(3000);
  const afterUndo = await layerRows("/^badge$/");
  await t2.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /^Elements$/.test(b.textContent.trim()))?.click()`);
  check("Undo of a change that added a layer takes its row out of the list at once (P2)", () => {
    assert.equal(hadBadge, 1);
    assert.equal(afterUndo, 0);
  });
} finally {
  t2.close();
  server.kill();
}
console.log(failed.length ? `\n${failed.length} check(s) failed. The site: ${SITE}` : "\nall checks passed");
process.exit(failed.length ? 1 : 0);
