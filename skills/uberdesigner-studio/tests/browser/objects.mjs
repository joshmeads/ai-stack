#!/usr/bin/env node
// Picking by clicks alone, on the VEYL-shaped fixture (tests/fixtures/veyl), in a real browser. The click rule
// (settled 17 Nov 2026): the page is a tree of things, whether the map lists them or not;
//   - at rest nothing is outlined; the pointer shows one outline, on what a click would pick, with its name;
//   - a click picks the block under the pointer; a section is picked on its own space; a top thing that isn't a
//     section (a card or a dock outside every section, a layer of a map with no sections) is itself the block;
//   - a double-click goes inside the picked block and picks the part under the pointer; from then on single clicks
//     pick at that level inside that block, whose edge is dashed; a click outside it is back at block level;
//   - a double-click on words picks that text and starts typing, at any depth;
//   - Escape goes up one level; at block level nothing is picked;
//   - cards that are one layer on several elements are picked together; going inside reaches one of them;
//   - the list is the same tree: a row for every thing, a row picks its thing in one click, the pointer on a row
//     outlines the thing on the page, picking on the page opens the rows above it;
//   - ⌘-click is only a shortcut to the smallest thing;
//   - the page is the outer layer: what no layer holds (a dock a script adds) is picked like anything else, listed at
//     the top, and kept by its place on the page;
//   - picking is only looking: the map and the files change when a picked thing is kept or changed, not before;
//   - the selection stays on its thing after a reload of the page, of the editor, a change of size and an edit
//     beside it; when the thing is gone the editor says so and picks the layer it sat in.
// And the nested-edits scenario: a heading and a picture in one card picked one after the other, the card from the
// list, the heading typed over.
//   node tests/browser/objects.mjs        needs Google Chrome (CHROME=… for another path); about 90 s
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = join(mkdtempSync(join(tmpdir(), "design-map-objects-")), "site");
cpSync(join(REPO, "tests", "fixtures", "veyl"), SITE, { recursive: true });
const applied = spawnSync(process.execPath, [join(REPO, "scripts", "apply.mjs"), SITE, join(SITE, "inspector.map.json")], { encoding: "utf8" });
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
const mapParts = () => JSON.parse(readFileSync(join(SITE, "inspector.map.json"), "utf8")).parts;
const page = () => readFileSync(join(SITE, "index.html"), "utf8");
const t = await openEditor(`http://localhost:${port}/__inspector/editor`);
// Pick a layer from the list and let the editor bring it into view
const fromList = async (id) => {
  await t.ev(`new Promise((done) => { const t0 = performance.now(); const row = document.querySelector('button[data-layer="${id}"]'); row?.click(); let seen = false; const tick = () => { const on = /mapping/.test(row?.textContent ?? ''); if (on) seen = true; const dt = performance.now() - t0; if ((seen && !on) || (!seen && dt > 600) || dt > 20000) done(1); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`);
  await t.sleep(600);
};
// The box of an element of the site, in the site's own pixels
const boxOf = (css) => t.fev(`(() => { const e = d.querySelector(${JSON.stringify(css)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); })()`);
// The outline with a given state, in the site's own pixels
const outline = (state) =>
  t.ev(`(() => { const f = document.querySelector('[data-state="${state}"]'); const frame = document.querySelector('iframe'); if (!f || !frame) return null; const b = f.getBoundingClientRect(); const r = frame.getBoundingClientRect(); const k = r.width / frame.contentWindow.innerWidth; return [(b.left - r.left) / k, (b.top - r.top) / k, b.width / k, b.height / k].map(Math.round); })()`);
const near = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 3);
const heading = () => t.ev(`[...document.querySelectorAll('h2,h3')].map(h => h.textContent.trim())[0] ?? ''`);
const rows = () => t.ev(`[...document.querySelectorAll('button[data-layer]')].map(b => b.dataset.layer)`);
const at = async (css, fx = 0.5, fy = 0.5) => {
  const b = await boxOf(css);
  return t.toEditor(b[0] + b[2] * fx, b[1] + b[3] * fy);
};
const META = 4;
const mouse = (type, x, y, more = {}) => t.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, ...more });
const hoverAt = async (x, y) => {
  await mouse("mouseMoved", x - 3, y);
  await t.sleep(120);
  await mouse("mouseMoved", x, y);
  await t.sleep(350);
};
const park = async () => {
  await mouse("mouseMoved", 2, 2);
  await t.sleep(250);
};
const click = async (css, more = {}) => {
  const [x, y] = await at(css);
  await mouse("mouseMoved", x, y, more);
  await mouse("mousePressed", x, y, more);
  await mouse("mouseReleased", x, y, more);
  await t.sleep(700);
};
const dbl = async (css) => {
  const [x, y] = await at(css);
  await t.dbl(x, y);
  await t.sleep(800);
};
const escape = async () => {
  await t.key("Escape", "Escape", 27);
  await t.sleep(350);
};
const count = (state) => t.ev(`document.querySelectorAll('[data-state="${state}"]').length`);
const typing = async () => (await t.fev(`!!(d.activeElement && d.activeElement.isContentEditable)`)) || (await t.ev(`!!(document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable))`));
const active = () => t.ev(`document.querySelector('[data-active="true"] button[data-layer]')?.dataset.layer ?? null`);
const rowBy = (label) => t.ev(`(() => { const b = [...document.querySelectorAll('button[data-layer]')].find((b) => b.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { id: b.dataset.layer, x: r.left + 40, y: r.top + r.height / 2 }; })()`);
const view = async (css) => {
  await t.fev(`d.querySelector(${JSON.stringify(css)}).scrollIntoView({ block: 'center' })`);
  await t.sleep(700);
};
const typeOver = async (words) => {
  await t.fev(`(() => { const e = d.activeElement; if (!e || !e.isContentEditable) return false; const r = d.createRange(); r.selectNodeContents(e); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await t.send("Input.insertText", { text: words });
  await t.key("Enter", "Enter", 13);
  await t.sleep(2500);
};

try {
  await t.sleep(3000);
  const before = JSON.stringify(mapParts());
  const source = page();

  // --- At rest, and the one outline under the pointer
  await fromList("silk"); // brings it into view
  await escape();
  await park();
  const atRest = await t.ev(`document.querySelectorAll('[data-state="idle"],[data-state="hover"],[data-state="selected"],[data-state="scope"],[data-state="deeper"]').length`);
  check("at rest nothing is outlined", () => assert.equal(atRest, 0));
  const [hx, hy] = await at(".silk h2");
  await hoverAt(hx, hy);
  const h2 = await boxOf(".silk h2");
  const h2Words = await t.fev(`d.querySelector('.silk h2').textContent.trim()`);
  const over = { boxes: await count("hover"), box: await outline("hover"), name: await t.ev(`document.querySelector('[data-state="hover"]')?.textContent.trim() ?? null`), row: await t.ev(`document.querySelector('[data-hover="true"] button[data-layer]')?.textContent.trim() ?? null`) };
  await click(".silk h2");
  const picked = { heading: await heading(), box: await outline("selected"), rows: await rows(), id: await active() };
  check("the pointer shows one outline, on what a click would pick, with its name", () => {
    assert.equal(over.boxes, 1);
    assert.ok(near(over.box, h2), `outlined ${over.box}, the heading ${h2}`);
    assert.equal(over.name, h2Words);
  });
  check("a click picks the block under the pointer, whether the map lists it or not", () => {
    assert.equal(picked.heading, h2Words);
    assert.ok(near(picked.box, h2), `outlined ${picked.box}, the heading ${h2}`);
    assert.match(picked.id ?? "", /^pick-/, `its row: ${picked.id}`);
    assert.equal(picked.rows[picked.rows.indexOf(picked.id) - 1], "silk", "it isn't listed under its section");
  });
  check("picking on the page opens the rows above it, and the list has a row for what the map never listed", () => {
    const under = picked.rows.slice(picked.rows.indexOf("silk") + 1, picked.rows.indexOf("thermal"));
    assert.equal(under.length, 2, `rows under the section: ${under.join(" ")}`);
    assert.ok(under.every((id) => id.startsWith("pick-")));
  });
  check("picking is only looking: the map and the files are as they were", () => {
    assert.equal(JSON.stringify(mapParts()), before);
    assert.equal(page(), source);
  });

  // Scrolled away by hand: the thing was seen, so no "not shown" box follows
  await t.fev(`w.scrollBy(0, 1600)`);
  await t.sleep(900);
  const followed = await t.ev(`document.querySelector('div[data-state="ghost"]')?.textContent ?? null`);
  check("scrolling away from a picked thing leaves no \"not shown\" box behind", () => assert.equal(followed, null));

  // A section is picked on its own space; Escape there leaves nothing picked
  await view(".silk");
  const silk = await boxOf(".silk");
  const [px, py] = await t.toEditor(silk[0] + 6, silk[1] + 6);
  await t.click(px, py);
  await t.sleep(700);
  const onSection = await heading();
  await escape();
  const afterEscape = await heading();
  check("a click on a section's own space picks the section, and Escape there leaves nothing picked", () => {
    assert.equal(onSection, mapParts().find((p) => p.id === "silk").label);
    assert.equal(afterEscape, "Nothing picked");
  });

  // --- A double-click on words picks that text and types over it
  await fromList("thermal");
  await escape();
  const pWords = await t.fev(`d.querySelector('.thermal p').textContent.trim()`);
  await dbl(".thermal p");
  const whileTyping = { typing: await typing(), heading: await heading(), box: await outline("selected"), el: await boxOf(".thermal p") };
  await escape(); // ends the typing, the words as they were
  const afterTyping = { typing: await typing(), heading: await heading() };
  check("a double-click on words picks that text and starts typing; Escape ends the typing and it stays picked", () => {
    assert.equal(whileTyping.typing, true, "the words can't be typed over");
    assert.ok(pWords.startsWith(whileTyping.heading.replace(/…$/, "")), `picked: ${whileTyping.heading}`);
    assert.ok(near(whileTyping.box, whileTyping.el), `outlined ${whileTyping.box}, the paragraph ${whileTyping.el}`);
    assert.equal(afterTyping.typing, false);
    assert.equal(afterTyping.heading, whileTyping.heading);
  });
  // Typing over words that aren't a layer writes them, and makes no layer of them: they belong to the layer they sit in
  await dbl(".thermal p");
  await typeOver("Typed over the page.");
  const typed = { heading: await heading(), box: await outline("selected"), el: await boxOf(".thermal p") };
  check("typing over words that aren't a layer writes them and adds no layer", () => {
    assert.match(page(), /Typed over the page\./);
    assert.ok(!mapParts().some((p) => p.picked), "the words became a layer of the map");
    assert.ok(!/data-dm="pick-/.test(page()), "a tag was written for them");
  });
  check("the typed-over text is still the picked thing, under its new words", () => {
    assert.equal(typed.heading, "Typed over the page.");
    assert.ok(near(typed.box, typed.el), `outlined ${typed.box}, the paragraph ${typed.el}`);
  });

  // A title split into letters is one block of words: no letter can be picked, not even with ⌘
  // (the fixture keeps its letters transparent, waiting for a reveal: here they are shown, as after it)
  // and laid out as flex items, which gives each letter a box of its own: still pieces of one line
  await t.fev(`(() => { const s = d.createElement('style'); s.textContent = '.woven__title { display: flex; } .woven__title span { opacity: 1 !important; }'; d.head.appendChild(s); })()`);
  await fromList("woven-title");
  await view(".woven__title");
  await escape();
  await click(".woven__title span:nth-of-type(3)");
  const onLetter = await heading();
  await escape();
  await click(".woven__title span:nth-of-type(3)", { modifiers: META });
  const onLetterDeep = await heading();
  check("one letter of a title can't be picked: the title is one block of words", () => {
    assert.equal(onLetter, "Woven title");
    assert.equal(onLetterDeep, "Woven title");
  });

  // --- Keep as layer
  await fromList("press");
  await escape();
  await click(".press p");
  const words = await heading();
  await t.ev(`[...document.querySelectorAll('button')].find(b => /^Keep as layer$/.test(b.textContent.trim()))?.click()`);
  await t.sleep(2500);
  const kept = mapParts().find((p) => p.picked);
  const keptState = { heading: await heading(), note: await t.ev(`[...document.querySelectorAll('p')].some(p => /Not a layer of the map yet/.test(p.textContent))`), box: await outline("selected"), p: await boxOf(".press p"), reload: await t.ev(`[...document.querySelectorAll('button')].some(b => /^Reload( layers)?$/.test(b.textContent.trim()))`), status: await t.status() };
  check("Keep as layer writes its tag into the file and its entry into the map, with no reload", () => {
    assert.ok(kept, "the map has no picked layer");
    assert.equal(kept.parent, "press");
    assert.equal(kept.targets[0].file, "index.html", `kept by address only: ${JSON.stringify(kept.targets)}`);
    assert.match(page(), new RegExp(`<p data-dm="${kept.id}">`));
    assert.equal(keptState.heading, words);
    assert.equal(keptState.note, false, "it still says it isn't a layer");
    assert.ok(near(keptState.box, keptState.p), `outlined ${keptState.box}, the paragraph ${keptState.p}`);
    assert.equal(keptState.reload, false, "a reload is offered");
    assert.match(keptState.status, /is a layer now/);
  });

  // --- Cards that are one layer on three elements: picked together; going inside reaches one of them
  await fromList("step");
  await view(".steps");
  await escape();
  await click(".step:nth-of-type(2) h3");
  const together = { heading: await heading(), boxes: await count("selected"), scope: await count("scope") };
  await dbl(".step:nth-of-type(2) h3"); // on words: that text, in that card, and typing
  await escape(); // the typing ends
  const inCard = { heading: await heading(), boxes: await count("selected"), box: await outline("selected"), el: await boxOf(".step:nth-of-type(2) h3"), scope: await outline("scope"), scopes: await count("scope"), card: await boxOf(".step:nth-of-type(2)"), id: await active(), rows: await rows() };
  check("cards that are one layer are picked together by a click", () => {
    assert.equal(together.heading, "Step card");
    assert.equal(together.boxes, 3);
    assert.equal(together.scope, 0, "a dashed edge at block level");
  });
  check("going inside reaches one of them: the heading of that card alone, and the card's edge is dashed", () => {
    assert.equal(inCard.heading, "Twist");
    assert.equal(inCard.boxes, 1, "it is outlined in every card");
    assert.ok(near(inCard.box, inCard.el), `outlined ${inCard.box}, the heading ${inCard.el}`);
    assert.equal(inCard.scopes, 1);
    assert.ok(near(inCard.scope, inCard.card), `dashed ${inCard.scope}, the card ${inCard.card}`);
    assert.equal(inCard.rows[inCard.rows.indexOf(inCard.id) - 1] === "step" || inCard.rows.indexOf(inCard.id) > inCard.rows.indexOf("step"), true, "its row isn't under the cards' row");
  });
  // Inside the card, single clicks pick at that level; outside it, back at block level
  const [lx, ly] = await at(".step:nth-of-type(2) p");
  await hoverAt(lx, ly);
  const lineHover = { box: await outline("hover"), el: await boxOf(".step:nth-of-type(2) p") };
  await click(".step:nth-of-type(2) p");
  const sibling = { heading: await heading(), boxes: await count("selected") };
  await click(".step:nth-of-type(3) h3");
  const outside = { heading: await heading(), boxes: await count("selected"), scope: await count("scope") };
  check("inside a block, the pointer and single clicks work at that level", () => {
    assert.ok(near(lineHover.box, lineHover.el), `the pointer shows ${lineHover.box}, the line ${lineHover.el}`);
    assert.equal(sibling.heading, "In pairs.");
    assert.equal(sibling.boxes, 1);
  });
  check("a click outside the block you are in is back at block level", () => {
    assert.equal(outside.heading, "Step card");
    assert.equal(outside.boxes, 3);
    assert.equal(outside.scope, 0);
  });
  // ⌘-click: the smallest thing there, in one click. Escape: up one level, then nothing.
  await click(".step:nth-of-type(2) h3", { modifiers: META });
  const deep = { heading: await heading(), boxes: await count("selected") };
  await escape();
  const up1 = await heading();
  await escape();
  const up2 = await heading();
  check("⌘-click is a shortcut to the smallest thing", () => {
    assert.equal(deep.heading, "Twist");
    assert.equal(deep.boxes, 1);
  });
  check("Escape goes up one level; at block level nothing is picked", () => {
    assert.equal(up1, "Step card");
    assert.equal(up2, "Nothing picked");
  });
  await click(".step:nth-of-type(2) h3", { modifiers: META });
  await t.ev(`[...document.querySelectorAll('button')].find(b => /^Keep as layer$/.test(b.textContent.trim()))?.click()`);
  await t.sleep(2500);
  check("a part picked inside one card of a row is kept in that card", () => {
    assert.match(page(), /<h3 data-dm="pick-[a-z0-9]+">Twist<\/h3>/);
    assert.equal((page().match(/<h3 data-dm=/g) ?? []).length, 1);
  });
  await fromList("silk");
  const later = await rows();
  check("a kept object stays in the list when something else is picked", () => assert.ok(kept && later.includes(kept.id), later.join(" ")));

  // Words laid over a canvas that is a layer: the canvas has no insides, the words are picked all the same
  await fromList("scene-canvas");
  await view(".scene");
  await escape();
  await click(".scene__words");
  const overCanvas = { heading: await heading(), box: await outline("selected"), el: await boxOf(".scene__words") };
  check("words laid over a canvas layer can be picked, not a line stacked on them whose letters don't show yet", () => {
    assert.equal(overCanvas.heading, "Grown in the dark.");
    assert.ok(near(overCanvas.box, overCanvas.el), `outlined ${overCanvas.box}, the words ${overCanvas.el}`);
  });

  // A layer that is a line of words, inside a card that isn't a layer: the card is the block, the line is inside it
  await fromList("contact-note");
  await view(".contact__card");
  await escape();
  await click(".contact__note");
  const card = { heading: await heading(), box: await outline("selected"), el: await boxOf(".contact__card"), id: await active() };
  await dbl(".contact__note");
  await escape();
  const note = { heading: await heading(), rows: await rows() };
  check("a card the map doesn't list is the block; the layer inside it is one level in, and listed under it", () => {
    assert.match(card.id ?? "", /^pick-/);
    assert.ok(near(card.box, card.el), `outlined ${card.box}, the card ${card.el}`);
    assert.equal(note.heading, "Contact note");
    assert.equal(note.rows[note.rows.indexOf("contact-note") - 1], card.id, `rows: ${note.rows.join(" ")}`);
  });

  // Preview stops when asked, whatever put the page in it. An Option key the editor never heard released (the key
  // let go while a screenshot tool had the keyboard): the button says "Stop preview", and pressing it stops it.
  const previewButton = () => t.ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^(Stop preview|Preview)/.test(b.textContent.trim())); const r = b.getBoundingClientRect(); return { says: b.textContent.trim().replace(/\\s+.*$/, ''), words: b.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 1 });
  await t.sleep(300);
  const held = await previewButton();
  await t.send("Input.dispatchMouseEvent", { type: "mousePressed", x: held.x, y: held.y, button: "left", clickCount: 1, modifiers: 1 });
  await t.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: held.x, y: held.y, button: "left", clickCount: 1, modifiers: 1 });
  await t.sleep(300);
  const stopped = await previewButton();
  await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18 });
  check("Stop preview stops it, even when it was a held Option that started it", () => {
    assert.match(held.words, /^Stop preview/);
    assert.match(stopped.words, /^Preview/, `after pressing it, the button says: ${stopped.words}`);
  });
  // Words being typed over that the site then takes away (it drew that piece again): picking comes back by itself
  await fromList("nature");
  await escape();
  await dbl(".nature p");
  const whileTypingButton = await previewButton();
  await t.fev(`d.querySelector('.nature p').remove()`);
  await t.sleep(2600);
  const afterGone = { button: await previewButton(), status: await t.status(), heading: await heading() };
  check("when the words being typed over are taken away by the site, picking comes back", () => {
    assert.match(whileTypingButton.words, /^Stop preview/, "typing didn't start");
    assert.match(afterGone.button.words, /^Preview/, `the button still says: ${afterGone.button.words}`);
  });
  check("when the picked thing is gone, the editor says so and picks the layer it sat in", () => {
    assert.match(afterGone.status, /isn't on the page any more/);
    assert.equal(afterGone.heading, mapParts().find((p) => p.id === "nature").label);
  });

  // --- The list is the same tree. Pictures the map left out are rows like any other; there is no separate list.
  await fromList("crowd");
  await view(".crowd");
  await escape();
  const offers = await t.ev(`!!document.querySelector('[data-suggestion]') || [...document.querySelectorAll('aside *')].some((x) => x.children.length === 0 && /^Not in the layers$/.test(x.textContent.trim()))`);
  check("there is no \"Not in the layers\" list", () => assert.equal(offers, false));
  // One ball: it sits in a layer that is never outlined itself and lets clicks through, and is picked by a plain click
  await click(".crowd__ball:nth-of-type(3)");
  const oneBall = { box: await outline("selected"), el: await boxOf(".crowd__ball:nth-of-type(3)"), boxes: await count("selected"), id: await active(), rows: await rows() };
  check("a picture inside a layer that is never outlined itself is picked by a plain click, alone", () => {
    assert.equal(oneBall.boxes, 1);
    assert.ok(near(oneBall.box, oneBall.el), `outlined ${oneBall.box}, the ball ${oneBall.el}`);
  });
  check("its row is shown, under the rows it sits in, with a row for each of the six", () => {
    const from = oneBall.rows.indexOf("crowd-field");
    assert.ok(from >= 0);
    assert.equal(oneBall.rows.slice(from + 1, from + 7).filter((id) => id.startsWith("pick-")).length, 6, oneBall.rows.join(" "));
    assert.ok(oneBall.rows.slice(from + 1, from + 7).includes(oneBall.id));
  });
  // A row: the pointer on it outlines its thing on the page, a click picks it
  const mapRow = await rowBy("Map of the colony");
  if (mapRow) await hoverAt(mapRow.x, mapRow.y);
  const rowHover = { box: await outline("hover"), el: await boxOf(".crowd__map") };
  if (mapRow) {
    await t.click(mapRow.x, mapRow.y);
    await t.sleep(1500);
  }
  await park();
  const rowPick = { heading: await heading(), box: await outline("selected"), el: await boxOf(".crowd__map") };
  check("the pointer on a row outlines its thing on the page, and a click on the row picks it", () => {
    assert.ok(mapRow, "the picture has no row");
    assert.ok(near(rowHover.box, rowHover.el), `the pointer on the row shows ${rowHover.box}, the picture ${rowHover.el}`);
    assert.equal(rowPick.heading, "Map of the colony");
    assert.ok(near(rowPick.box, rowPick.el), `outlined ${rowPick.box}, the picture ${rowPick.el}`);
  });

  // The pinned story: the one line that shows now, and the picture
  await fromList("story");
  await escape();
  await t.fev(`w.scrollTo(0, d.querySelector('.story').getBoundingClientRect().top + w.scrollY + w.innerHeight * (1 + 0.8 * 2 + 0.4))`);
  await t.sleep(900);
  await click(".story__scene.is-on");
  const line = { heading: await heading(), box: await outline("selected"), el: await boxOf(".story__scene.is-on") };
  await click(".story__pic");
  const pic = { box: await outline("selected"), el: await boxOf(".story__pic"), row: await active() };
  check("in a pinned story the line that shows now can be picked, and the picture", () => {
    assert.equal(line.heading, "Twisted in pairs.");
    assert.ok(near(line.box, line.el), `outlined ${line.box}, the line ${line.el}`);
    assert.ok(near(pic.box, pic.el), `outlined ${pic.box}, the picture ${pic.el}`);
    assert.match(pic.row ?? "", /^pick-/, "the picture has no row");
  });

  // --- The page is the outer layer: a dock the fixture's script adds to the page, in no section and so in no layer
  // The dock isn't a section (nothing says so: not the map, not its element, not its width), so it is a block: a
  // click on the light picks the dock, a double-click goes inside to the light, Escape there is back on the dock
  await escape();
  await click(".dock__light");
  const dockFirst = { box: await outline("selected"), el: await boxOf(".dock") };
  await dbl(".dock__light");
  const dockLight = {
    box: await outline("selected"),
    el: await boxOf(".dock__light"),
    id: await active(),
    depth: await t.ev(`document.querySelector('[data-active="true"]')?.style.getPropertyValue('--depth') ?? null`),
    motion: await t.ev(`[...document.querySelectorAll('p')].map((p) => p.textContent.trim()).find((x) => /^Animation: dock-pulse/.test(x)) ?? null`),
  };
  await escape();
  await t.sleep(400);
  const dockUp = { box: await outline("selected") };
  const dockBox = await boxOf(".dock");
  const [dkx, dky] = await t.toEditor(dockBox[0] + 6, dockBox[1] + dockBox[3] / 2); // its own space: the padding left of the light (its corners are rounded off)
  await t.click(dkx, dky);
  await t.sleep(700);
  const dock = { box: await outline("selected"), id: await active(), depth: await t.ev(`document.querySelector('[data-active="true"]')?.style.getPropertyValue('--depth') ?? null`) };
  check("a block outside every section is picked whole by a click on a part of it", () => {
    assert.ok(near(dockFirst.box, dockFirst.el), `outlined ${dockFirst.box}, the dock ${dockFirst.el}`);
  });
  check("Escape on a part of such a block is back on the block", () => {
    assert.ok(near(dockUp.box, dockFirst.el), `outlined ${dockUp.box}, the dock ${dockFirst.el}`);
  });
  check("something in no layer at all is picked from the page by clicks alone, and its CSS motion shows", () => {
    assert.ok(near(dockLight.box, dockLight.el), `outlined ${dockLight.box}, the light ${dockLight.el}`);
    assert.match(dockLight.id ?? "", /^pick-/, "no row for it");
    assert.ok(dockLight.motion, "the panel shows no Animation: dock-pulse");
  });
  check("what holds it is picked on its own space, and listed at the top of the list like a section", () => {
    assert.ok(near(dock.box, dockBox), `outlined ${dock.box}, the dock ${dockBox}`);
    assert.match(dock.id ?? "", /^pick-/);
    assert.equal(String(dock.depth), "0");
    assert.equal(String(dockLight.depth), "1");
  });
  await click(".dock__light");
  const htmlBefore = page();
  await t.ev(`[...document.querySelectorAll('button')].find(b => /^Keep as layer$/.test(b.textContent.trim()))?.click()`);
  await t.sleep(1500);
  const keptDock = mapParts().find((p) => p.picked && /^(body|#)/.test(p.targets?.[0]?.selector ?? "") && !p.parent);
  const keptHits = keptDock ? await t.fev(`d.querySelectorAll(${JSON.stringify(keptDock?.targets?.[0]?.selector ?? "x")}).length`) : 0;
  check("Keep as layer keeps it by its place on the page and touches no file", () => {
    assert.ok(keptDock, `the map has no such layer: ${JSON.stringify(mapParts().filter((p) => p.picked).map((p) => p.targets))}`);
    assert.equal(keptHits, 1, `its address: ${JSON.stringify(keptDock?.targets)}`);
    assert.equal(page(), htmlBefore, "index.html changed");
  });

  // --- Nested edits: a heading and a picture in one card, the card from the list, the heading typed over
  await fromList("contact");
  await view(".contact__maker");
  await escape();
  await click(".contact__maker h3");
  const maker = { heading: await heading(), box: await outline("selected"), el: await boxOf(".contact__maker"), id: await active() };
  await dbl(".contact__face"); // not on words: one level in, to the picture
  const face = { heading: await heading(), box: await outline("selected"), el: await boxOf(".contact__face"), scope: await outline("scope"), typing: await typing() };
  await click(".contact__maker h3"); // inside the card now: a single click
  const name = { heading: await heading(), box: await outline("selected"), el: await boxOf(".contact__maker h3") };
  const makerRow = await rowBy(maker.heading);
  if (makerRow) {
    await t.click(makerRow.x, makerRow.y);
    await t.sleep(1500);
  }
  await park();
  const fromRow = { heading: await heading(), box: await outline("selected"), el: await boxOf(".contact__maker") };
  check("the card is the block: a click on its heading picks the card", () => {
    assert.match(maker.id ?? "", /^pick-/);
    assert.ok(near(maker.box, maker.el), `outlined ${maker.box}, the card ${maker.el}`);
  });
  check("a double-click on the picture goes inside the card and picks the picture", () => {
    assert.equal(face.typing, false);
    assert.equal(face.heading, "Ines at the loom");
    assert.ok(near(face.box, face.el), `outlined ${face.box}, the picture ${face.el}`);
    assert.ok(near(face.scope, maker.el), `dashed ${face.scope}, the card ${maker.el}`);
  });
  check("then a single click picks the heading beside it", () => {
    assert.equal(name.heading, "Ines Marlow");
    assert.ok(near(name.box, name.el), `outlined ${name.box}, the heading ${name.el}`);
  });
  check("the card is picked from its row in the list", () => {
    assert.equal(makerRow?.id, maker.id);
    assert.equal(fromRow.heading, maker.heading);
    assert.ok(near(fromRow.box, fromRow.el), `outlined ${fromRow.box}, the card ${fromRow.el}`);
  });
  await dbl(".contact__maker h3");
  await typeOver("Ines M. Marlow");
  await escape();
  await escape();
  await click(".contact__maker p");
  await dbl(".contact__face");
  const around = { heading: await heading(), box: await outline("selected"), el: await boxOf(".contact__face") };
  check("the heading is typed over, and what is around it still works", () => {
    assert.match(page(), /<h3>Ines M\. Marlow<\/h3>/);
    assert.equal(around.heading, "Ines at the loom");
    assert.ok(near(around.box, around.el), `outlined ${around.box}, the picture ${around.el}`);
  });

  // --- The selection stays on its thing (the picture, which the map doesn't list)
  const stays = async () => {
    await view(".contact__maker");
    return { heading: await heading(), box: await outline("selected"), el: await boxOf(".contact__face"), boxes: await count("selected") };
  };
  await t.fev(`w.location.reload()`);
  await t.sleep(5000);
  const afterPage = await stays();
  await t.ev(`[...document.querySelectorAll('button[role="radio"]')].find((b) => /Tablet/.test(b.textContent))?.click()`);
  await t.sleep(2000);
  const atTablet = await stays();
  await t.ev(`[...document.querySelectorAll('button[role="radio"]')].find((b) => /Desktop/.test(b.textContent))?.click()`);
  await t.sleep(2000);
  await t.ev(`location.reload()`);
  await t.sleep(9000);
  const afterEditor = await stays();
  // Something added beside it: its place among its neighbours changes, it is still the picked thing
  await t.fev(`(() => { const x = d.createElement('div'); x.className = 'contact__extra'; x.textContent = 'Added beside it.'; const m = d.querySelector('.contact__maker'); m.parentElement.insertBefore(x, m); const y = d.createElement('img'); y.width = 20; y.height = 20; y.alt = 'Another'; m.insertBefore(y, m.firstChild); })()`);
  await t.sleep(1800);
  const afterEdit = await stays();
  const stayed = (s) => s.heading === "Ines at the loom" && s.boxes === 1 && near(s.box, s.el);
  check("the selection stays on its thing after the page reloads", () => assert.ok(stayed(afterPage), JSON.stringify(afterPage)));
  check("the selection stays on its thing at another device size", () => assert.ok(stayed(atTablet), JSON.stringify(atTablet)));
  check("the selection stays on its thing after the editor itself reloads", () => assert.ok(stayed(afterEditor), JSON.stringify(afterEditor)));
  check("the selection stays on its thing when something is added beside it", () => assert.ok(stayed(afterEdit), JSON.stringify(afterEdit)));
} finally {
  t.close();
  server.kill();
}
console.log(failed.length ? `\n${failed.length} check(s) failed. The site: ${SITE}` : "\nobjects: all checks passed");
process.exit(failed.length ? 1 : 0);
