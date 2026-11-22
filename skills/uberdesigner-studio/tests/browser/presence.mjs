#!/usr/bin/env node
// Whether the editor says the truth about a layer being on screen, on the VEYL-shaped fixture (tests/fixtures/veyl),
// in a real browser. The cases come from a real site (a friend's report of 16 Nov on a 240,000 px story page):
//   - a long pinned story shows nothing at its own top (the scene before still fills the screen there): picked from
//     the list, it is looked for along its own height and found, in a few seconds;
//   - while one of its nine lines shows and the other eight are transparent, the story is on screen (not "hidden"),
//     and in the gap where only its picture shows too;
//   - a layer something solid is painted over (a card with an opaque gradient) has no outline and its row says
//     hidden, while one under a veil that fades out stays in view;
//   - a title whose letters are all transparent, with nothing else to it, is said to be not shown, and why.
//   node tests/browser/presence.mjs [--skill <checkout of another version>]     needs Google Chrome; about 30 s
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL = resolve(process.argv.includes("--skill") ? process.argv[process.argv.indexOf("--skill") + 1] : REPO);
const TAG = existsSync(join(SKILL, "runtime", "server", "address.ts")) ? "data-dm" : "data-part";
const SITE = join(mkdtempSync(join(tmpdir(), "design-map-presence-")), "site");
cpSync(join(REPO, "tests", "fixtures", "veyl"), SITE, { recursive: true });
const applied = spawnSync(process.execPath, [join(SKILL, "scripts", "apply.mjs"), SITE, join(SITE, "inspector.map.json")], { encoding: "utf8" });
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
const t = await openEditor(`http://localhost:${port}/__inspector/editor`);
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
// Pick a layer from the list; seconds until the editor has finished bringing it into view
const pick = async (id) => {
  const ms = await t.ev(`new Promise((done) => { const t0 = performance.now(); const row = document.querySelector('button[data-layer="${id}"]'); row?.click(); let seen = false; const tick = () => { const on = /mapping/.test(row?.textContent ?? '') || /Looking for/.test(document.querySelector('footer')?.innerText ?? ''); if (on) seen = true; const dt = performance.now() - t0; if ((seen && !on) || (!seen && dt > 600) || dt > 40000) done(Math.round(dt)); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`);
  await t.sleep(500);
  return ms / 1000;
};
const row = (id) => t.ev(`document.querySelector('button[data-layer="${id}"]')?.textContent.trim() ?? ''`);
const ghost = () => t.ev(`document.querySelector('div[data-state="ghost"]')?.textContent ?? null`);
try {
  await t.sleep(3000);
  const storyTop = await t.fev(`Math.round(d.querySelector('[${TAG}="story"]').getBoundingClientRect().top + w.scrollY)`);
  const screen = await t.fev(`w.innerHeight`);

  const seconds = await pick("story");
  const status = await t.status();
  const y = await t.fev(`Math.round(w.scrollY)`);
  const boxed = await ghost();
  check(`the story is found along its own height (${seconds.toFixed(1)} s, page at ${y - storyTop} px into it)`, () => {
    assert.ok(!/isn.t shown|not shown/.test(status), `the footer says: ${status}`);
    assert.equal(boxed, null, `a "not shown" box is drawn: ${boxed}`);
    assert.ok(y > storyTop + screen * 0.9, `the page is at the story's top (${y - storyTop} px in), where nothing of it shows`);
    assert.ok(seconds < 8, `it took ${seconds} s`);
  });

  // One line at a time: the third and the sixth (the old rule looked at six of the nine and missed these)
  for (const line of [2, 5]) {
    await t.fev(`w.scrollTo(0, ${storyTop} + w.innerHeight * (1 + 0.8 * ${line} + 0.4))`);
    await t.sleep(900);
    const shown = await t.fev(`[...d.querySelectorAll('.story__scene')].findIndex((s) => w.getComputedStyle(s).opacity === '1')`);
    const chip = await row("story");
    check(`with only line ${line + 1} of nine showing, the story is on screen`, () => {
      assert.equal(shown, line, "the fixture shows another line than the test expects");
      assert.ok(!/hidden$/.test(chip), `its row says: ${chip}`);
    });
  }

  // What a card is painted over has no outline; what a veil lies over keeps its own
  await t.fev(`d.querySelector('.pile').scrollIntoView({ block: 'center' })`);
  await t.sleep(1200);
  const under = await row("pile-under");
  const veiled = await row("pile-veiled");
  const card = await row("pile-card");
  check("a layer a card is painted over (an opaque gradient) is hidden; one under a veil that fades out is not", () => {
    assert.match(under, /hidden$/, `the pill under the card: ${under}`);
    assert.ok(!/hidden$/.test(veiled), `the pill under the veil: ${veiled}`);
    assert.ok(!/hidden$/.test(card), `the card itself: ${card}`);
  });

  const title = await pick("woven-title");
  const said = await t.status();
  check(`a title of transparent letters is said to be not shown (${title.toFixed(1)} s)`, () => assert.match(said, /words are transparent/));
} finally {
  t.close();
  server.kill();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\npresence: all checks passed");
process.exit(0);
