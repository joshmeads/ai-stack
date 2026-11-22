#!/usr/bin/env node
// Cards and History as a person uses them, in a real browser (step 5): a tiny site, the inspector installed by
// apply.mjs, its own server, and a stand-in for Claude Code that returns a scripted answer (nothing is sent to Claude).
//   - a change has a number: on its card and on a pin over its part, and nothing frames the changed part;
//   - Keep doesn't make the card vanish: it moves to the Resolved tab, marked Kept, with its number; its pin leaves
//     the page and the layer is no longer marked as changed; a resolved card can't be taken off the list;
//   - a kept change can still be undone on its own, with a change made after it left alone;
//   - a change that is out of the page can be brought back;
//   - when later work rewrote the same lines, Bring back says so and touches nothing;
//   - a change that needs the page reloaded never reloads it by itself: a bar says the change waits, its button shows it;
//   - History lists points, with every step one click away; going back to a point makes the cards say what it held.
//   node tests/browser/cards.mjs        needs Google Chrome (CHROME=… for another path); about 40 s
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = mkdtempSync(join(tmpdir(), "design-map-cards-"));
const CAPTURE = mkdtempSync(join(tmpdir(), "design-map-cards-capture-"));
const TITLE = ".hero h1 { color: var(--ink); }";
const SMALL = ".foot small { color: #555555; }";
writeFileSync(
  join(SITE, "index.html"),
  `<!doctype html><html><head><title>Cards</title><style>
:root { --ink: #111111; }
body { margin: 0; font-family: sans-serif; }
.hero { padding: 24px; }
${TITLE}
.hero p { margin: 0; }
.foot { padding: 24px; }
${SMALL}
</style></head><body>
<section class="hero"><h1>Hello</h1><p>Lead</p></section>
<footer class="foot"><small>Since 1962</small></footer>
</body></html>
`,
);
const part = (id, label, find) => ({ id, label, group: "Page", prompt: [{ where: "index.html", text: label }], tokens: [], files: ["index.html"], edit: ["index.html"], targets: [{ file: "index.html", find }] });
writeFileSync(join(SITE, "map.draft.json"), JSON.stringify({ version: 1, name: "Cards", facts: [], tokensFile: "index.html", extraFiles: [], groups: ["Page"], tokens: {}, parts: [part("hero", "Hero", 'class="hero"'), part("foot", "Footer", 'class="foot"')] }));
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
const css = () => readFileSync(join(SITE, "index.html"), "utf8");
const t = await openEditor(`http://localhost:${port}/__inspector/editor`);
const jobsNow = () => t.ev(`fetch('/__inspector/jobs').then(r => r.json()).then(d => d.jobs)`);
const tab = (re) => t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => ${re}.test(b.textContent.trim()))?.click()`);
// Press a button by its words, inside the card that mentions `within` (or anywhere)
const press = (re, within) =>
  t.ev(`(() => { const scope = ${within ? `[...document.querySelectorAll('article')].find(a => a.textContent.includes(${JSON.stringify(within)}))` : "document"}; const b = scope && [...scope.querySelectorAll('button')].find(b => ${re}.test(b.textContent.trim()) && !b.disabled); if (!b) return false; b.click(); return true; })()`);
const cards = () => t.ev(`[...document.querySelectorAll('article')].map(a => a.textContent.replace(/\\s+/g, ' ').trim().slice(0, 140))`);
const cardOf = async (words) => (await cards()).find((c) => c.includes(words)) ?? null;
// Ask for a change to a layer the way a person does: pick it, type in the chat bar, press Run; Claude's answer is scripted
const change = async (layer, request, find, replace) => {
  const had = new Set((await jobsNow()).map((j) => j.id));
  writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify({ summary: `${request} Done.`, edits: [{ file: "index.html", find, replace }], create: [] }));
  await t.ev(`document.querySelector('button[data-layer="${layer}"]').click()`);
  await t.sleep(500);
  await t.ev(`(() => { const a = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(a, ${JSON.stringify(request)}); a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.sleep(300);
  await t.ev(`[...document.querySelectorAll('button')].find(b => /^(Run|Queue)$/.test(b.textContent.trim()) && !b.disabled).click()`);
  for (let i = 0; i < 100; i++) {
    await t.sleep(300);
    const j = (await jobsNow()).find((x) => !had.has(x.id));
    if (j && (j.state === "done" || j.state === "error")) {
      await t.sleep(1200);
      return j;
    }
  }
  throw new Error("the change never finished");
};

try {
  await t.sleep(3000);
  const wide = await change("hero", "Space the headline's letters.", TITLE, ".hero h1 { color: var(--ink); letter-spacing: 2px; }");
  const chipBefore = await t.ev(`!!document.querySelector('[data-changed="true"] button[data-layer="hero"]')`);
  await tab("/changes/i");
  await t.sleep(400);
  // The numbers: on each card, and on the pins over the page; what frames or labels a part over the page
  const pins = () => t.ev(`[...document.querySelectorAll('button[data-on="page"]')].map(b => b.textContent.trim())`);
  const numberOf = (words) => t.ev(`[...document.querySelectorAll('article')].find(a => a.textContent.includes(${JSON.stringify(words)}))?.dataset.number ?? null`);
  const numbered = { card: await numberOf("Space the headline"), pins: await pins(), framed: await t.ev(`document.querySelector('iframe').parentElement.querySelectorAll('[data-state="changed"]').length`), replay: await t.ev(`document.querySelectorAll('article button[aria-label="Replay the page"]').length`) };
  check("a change has a number, on its card and on a pin over its part; nothing frames the changed part", () => {
    assert.equal(numbered.card, "1");
    assert.deepEqual(numbered.pins, ["1"]);
    assert.equal(numbered.framed, 0, "the changed part is framed over the page");
    assert.equal(numbered.replay, 0, "the card has a replay button");
  });
  const keptPressed = await press("/^Keep$/", "Space the headline");
  await t.sleep(1200);
  const openAfterKeep = await cardOf("Space the headline");
  const pinsAfterKeep = await pins();
  const resolvedTab = await t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /^Resolved/.test(b.textContent.trim()))?.textContent.trim().replace(/\\s+/g, ' ') ?? null`);
  await tab("/^Resolved/");
  await t.sleep(400);
  const keptCard = await cardOf("Space the headline");
  const keptNumber = await numberOf("Space the headline");
  const removers = await t.ev(`[...document.querySelectorAll('article button[aria-label="Close"]')].length + [...document.querySelectorAll('button')].filter(b => /^Clear resolved$/.test(b.textContent.trim())).length`);
  const chipAfter = await t.ev(`!!document.querySelector('[data-changed="true"] button[data-layer="hero"]')`);
  check("Keep moves the card to Resolved, marked Kept, with its number; its pin leaves and the layer is no longer marked as changed", () => {
    assert.equal(wide.state, "done", wide.error);
    assert.equal(chipBefore, true, "the layer wasn't marked as changed before Keep");
    assert.equal(keptPressed, true, "no Keep button on the card");
    assert.equal(openAfterKeep, null, `the card still waits among the open ones: ${openAfterKeep}`);
    assert.deepEqual(pinsAfterKeep, [], "the kept change still has its pin");
    assert.equal(resolvedTab, "Resolved 1");
    assert.match(keptCard ?? "(no card)", /^Kept/);
    assert.equal(keptNumber, "1");
    assert.equal(removers, 0, "a resolved card can be taken off the list");
    assert.equal(chipAfter, false);
  });

  const grey = await change("foot", "Lighten the small print.", SMALL, ".foot small { color: #777777; }");
  await tab("/changes/i");
  await t.sleep(400);
  const second = { card: await numberOf("Lighten the small print"), pins: await pins() };
  check("the next change takes the next number", () => {
    assert.equal(second.card, "2");
    assert.deepEqual(second.pins, ["2"]);
  });
  // A pin is a way to its card: pressed with another tab open, AI changes opens
  await tab("/^Elements/");
  await t.sleep(300);
  await t.ev(`document.querySelector('button[data-on="page"]').click()`);
  await t.sleep(500);
  const afterPin = await t.ev(`[...document.querySelectorAll('button[role=tab][aria-selected=true]')].map(b => b.textContent.trim().replace(/\\s+/g, ' '))`);
  check("pressing a pin opens AI changes on its card", () => assert.ok(afterPin.some((x) => /^AI changes/.test(x)), `open tabs: ${afterPin.join(", ")}`));
  await tab("/^Resolved/");
  await t.sleep(400);
  const undone = await press("/^Undo$/", "Space the headline");
  await t.sleep(2500);
  const afterUndo = css();
  const outCard = await cardOf("Space the headline");
  check("a kept change can still be undone on its own; the change made after it stays", () => {
    assert.equal(grey.state, "done", grey.error);
    assert.equal(undone, true, "no Undo on the kept card");
    assert.ok(afterUndo.includes(TITLE) && !afterUndo.includes("letter-spacing"), "the headline's rule isn't back");
    assert.ok(afterUndo.includes("#777777"), "the later change went with it");
    assert.match(outCard ?? "(no card)", /^Not in the page now/);
  });

  const back = await press("/^Bring back$/", "Space the headline");
  await t.sleep(2500);
  const afterBack = css();
  const backCard = await cardOf("Space the headline");
  check("a change that is out of the page can be brought back", () => {
    assert.equal(back, true, "no Bring back on the card");
    assert.ok(afterBack.includes("letter-spacing: 2px") && afterBack.includes("#777777"));
    assert.match(backCard ?? "(no card)", /^Kept/);
  });

  // The same lines rewritten by a later change: Bring back refuses and touches nothing
  await press("/^Undo$/", "Space the headline");
  await t.sleep(2500);
  const light = await change("hero", "Make the headline lighter.", TITLE, ".hero h1 { color: var(--ink); font-weight: 400; }");
  await tab("/^Resolved/");
  await t.sleep(400);
  const before = css();
  await press("/^Bring back$/", "Space the headline");
  await t.sleep(2500);
  const refusedCard = await cardOf("Space the headline");
  check("when later work rewrote the same lines, Bring back says so and touches nothing", () => {
    assert.equal(light.state, "done", light.error);
    assert.equal(css(), before);
    assert.match(refusedCard ?? "(no card)", /rewrote the same lines/);
    assert.match(refusedCard ?? "", /^Not in the page now/);
  });

  // A change to the page's markup can't be shown without a reload. The page is never reloaded at a moment the person
  // didn't choose: a bar over it says their change is waiting, and its button reloads
  await t.fev(`(w.__before = true)`);
  const year = await change("foot", "Make it 1961.", "<small>Since 1962</small>", "<small>Since 1961</small>");
  await t.sleep(2500);
  const bar = () => t.ev(`[...document.querySelectorAll('[role=status]')].map(b => b.textContent.replace(/\\s+/g, ' ').trim()).find(x => /Reload page/.test(x)) ?? null`);
  const waiting = { marker: await t.fev(`w.__before === true`), words: await t.fev(`d.querySelector('small')?.textContent ?? ''`), bar: await bar() };
  await press("/^Reload page$/");
  await t.sleep(2500);
  const shown = { marker: await t.fev(`w.__before === true`), words: await t.fev(`d.querySelector('small')?.textContent ?? ''`), bar: await bar() };
  check("a change that needs a reload doesn't reload the page by itself: the bar says it waits, and its button shows it", () => {
    assert.equal(year.state, "done", year.error);
    assert.equal(waiting.marker, true, "the page was reloaded without being asked");
    assert.equal(waiting.words, "Since 1962");
    assert.match(waiting.bar ?? "(no bar)", /^Your change is in the code\. Reload the page to see it\./);
    assert.equal(shown.marker, false, "the button didn't reload the page");
    assert.equal(shown.words, "Since 1961");
    assert.equal(shown.bar, null, "the bar is still asking after the reload");
  });
  await tab("/changes/i");
  await t.sleep(300);
  // Undo, on a change that was never kept: its pin leaves the page and its card rests in Resolved with its number
  const pinsBeforeUndo = await pins();
  await press("/^Undo$/", "Lighten the small print");
  await t.sleep(2500);
  const pinsAfterUndo = await pins();
  const stillWaiting = await cardOf("Lighten the small print");
  await tab("/^Resolved/");
  await t.sleep(400);
  const undoneCard = { words: await cardOf("Lighten the small print"), number: await numberOf("Lighten the small print") };
  check("Undo takes the change's pin off the page; its card rests in Resolved with its number", () => {
    assert.ok(pinsBeforeUndo.includes("2"), `pins before: ${pinsBeforeUndo}`);
    assert.ok(!pinsAfterUndo.includes("2"), `pins after: ${pinsAfterUndo}`);
    assert.equal(stillWaiting, null, "the undone card still waits in AI changes");
    assert.match(undoneCard.words ?? "(no card)", /^Not in the page now/);
    assert.equal(undoneCard.number, "2");
  });

  // History: points, with every step behind one click
  await t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /^History$/.test(b.textContent.trim()))?.click()`);
  await t.sleep(1200);
  const rows = () => t.ev(`[...document.querySelectorAll('ol > li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90))`);
  const points = await rows();
  await press("/^Every step \\(\\d+\\)$/");
  await t.sleep(500);
  const steps = await rows();
  await press("/^Points only$/");
  await t.sleep(400);
  check("History lists points to go back to, not every action; every step is one click away", () => {
    assert.ok(points.length >= 2 && points.length < steps.length, `points ${points.length}, steps ${steps.length}: ${points.join(" | ")}`);
    assert.match(points[0], /now$/);
    assert.ok(points.some((r) => /Starting point/.test(r)), points.join(" | "));
    assert.ok(steps.length >= 7, `only ${steps.length} steps`);
  });

  // Go back to the start: the page is as it began, and every card says its change is out of the page
  await t.ev(`(() => { const li = [...document.querySelectorAll('ol > li')].find(li => /Starting point/.test(li.textContent)); [...li.querySelectorAll('button')].find(b => /^Go back here$/.test(b.textContent.trim())).click(); })()`);
  await t.sleep(3500);
  const atStart = css();
  const states = (await jobsNow()).filter((j) => j.entry).map((j) => j.undone);
  check("going back to a point puts the whole site back, and the cards say what that point held", () => {
    assert.ok(atStart.includes(TITLE) && atStart.includes(SMALL), "the site isn't as it started");
    assert.ok(states.length >= 3 && states.every(Boolean), `cards still in the page: ${states}`);
  });
} finally {
  t.close();
  server.kill();
}
console.log(failed.length ? `\n${failed.length} check(s) failed. The site: ${SITE}` : "\ncards: all checks passed");
process.exit(failed.length ? 1 : 0);
