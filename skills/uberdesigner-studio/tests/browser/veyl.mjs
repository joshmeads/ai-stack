#!/usr/bin/env node
// The problems the tester's report of 15 Nov found on VEYL, replayed on the VEYL-shaped fixture (tests/fixtures/veyl)
// with any version of the skill, so two versions can be put side by side:
//
//   node tests/browser/veyl.mjs [--skill <folder of a checkout of the skill>] [--only P5,P4,P2,searches] [--out result.json]
//
// --skill: the version to install on a copy of the fixture (its scripts/apply.mjs and runtime/); default: this one.
// What it does, as a person would in the editor, with a scripted answer in Claude's place (nothing is sent to Claude):
//   P5  type an invalid colour into "Ink black" on the section menu and press Save: is it written to style.css?
//   P4  at Phone size, a change that adds top padding to the archive heading in style.css, which mobile.css resets:
//       what does the card say, what does the page show, and was mobile.css's rule in what Claude was sent?
//   P2  a change that adds a block with three layers after Contact, then Undo: are its rows still in the layer list,
//       and its entries still in the map? (P3: when do the new rows appear at all?)
//   and how long the editor takes to bring the pinned and the moving layers into view.
// It prints what it saw as JSON; it judges nothing (older versions are expected to show the problems).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : null);
const SKILL = resolve(arg("skill") ?? REPO);
const TAG = existsSync(join(SKILL, "runtime", "server", "address.ts")) ? "data-dm" : "data-part"; // what this version's layers are tagged with
const SITE = join(mkdtempSync(join(tmpdir(), "design-map-veyl-")), "site");
const CAPTURE = mkdtempSync(join(tmpdir(), "design-map-veyl-capture-"));
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
const server = spawn(process.execPath, [join(SITE, ".inspector", "tool", "server", "serve.ts"), "--port", String(port)], {
  cwd: SITE,
  env: { ...process.env, CLAUDE_BIN: join(REPO, "tests", "sites", "fake-claude.mjs"), CAPTURE_DIR: CAPTURE },
  stdio: "ignore",
});
await sleep(1500);

const file = (name) => readFileSync(join(SITE, name), "utf8");
const ORIGINAL = { "style.css": file("style.css"), "index.html": file("index.html") };
const EDITOR = `http://localhost:${port}/__inspector/editor`;
const out = { skill: SKILL, tag: TAG };
const only = arg("only")?.split(",");
const wanted = (name) => !only || only.includes(name);

const open = async () => {
  const t = await openEditor(EDITOR);
  await t.sleep(3000);
  return t;
};
const jobs = (t) => t.ev(`fetch('/__inspector/jobs').then(r => r.json()).then(d => d.jobs)`);
const rows = (t, re) => t.ev(`[...document.querySelectorAll('button[data-layer]')].map(b => b.dataset.layer).filter(id => ${re}.test(id))`);
const press = (t, re) => t.ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent.trim()) && !b.disabled); if (!b) return false; b.click(); return true; })()`);
const pick = async (t, id, wait = 1200) => {
  await t.ev(`document.querySelector('button[data-layer="${id}"]')?.click()`);
  await t.sleep(wait);
};
// A change asked the way a person asks: typed into the chat bar, Run pressed; Claude's answer is the scripted one
const change = async (t, request, answer) => {
  const had = new Set((await jobs(t)).map((j) => j.id));
  writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify({ create: [], ...answer }));
  await t.ev(`(() => { const a = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(a, ${JSON.stringify(request)}); a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.sleep(400);
  await press(t, "/^(Run|Queue)$/");
  for (let i = 0; i < 100; i++) {
    await t.sleep(300);
    const j = (await jobs(t)).find((x) => !had.has(x.id));
    if (j && (j.state === "done" || j.state === "error")) return j.id;
  }
  throw new Error("the change never finished");
};
const jobNow = async (t, id) => (await jobs(t)).find((x) => x.id === id);
const lastSent = () => JSON.parse(readFileSync(join(CAPTURE, readdirSync(CAPTURE).filter((f) => f !== "answer.json").sort().at(-1)), "utf8")).input;
const cardText = (t) => t.ev(`(document.querySelector('aside:last-of-type')?.textContent ?? '').replace(/\\s+/g, ' ').trim()`);

// --- P5: an invalid colour typed into a colour field, then Save
if (wanted("P5")) {
  const t = await open();
  try {
    out.P5 = [];
    for (const value of ["notacolor", "rgb(0,0"]) {
      await pick(t, "header-nav");
      const typed = await t.ev(`(() => { const i = [...document.querySelectorAll('aside:last-of-type input')].find(i => (i.type === 'text' || !i.getAttribute('type')) && i.value.trim().toLowerCase() === '#080808'); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await t.sleep(500);
      const flagged = await t.ev(`!!document.querySelector('aside:last-of-type [role=alert]') || !!document.querySelector('aside:last-of-type [data-invalid="true"]')`);
      const saveEnabled = await press(t, "/^Save$/");
      await t.sleep(1800);
      const status = await t.status();
      const rule = file("style.css").match(/\[data-(?:dm|part)="header-nav"\]\s*\{[^}]*\}?/)?.[0].replace(/\s+/g, " ") ?? null;
      out.P5.push({ value, typed, flaggedInTheField: flagged, savePressed: saveEnabled, status, writtenToStyleCss: file("style.css").includes(value), ruleInStyleCss: rule });
      writeFileSync(join(SITE, "style.css"), ORIGINAL["style.css"]);
      await press(t, "/^Reset$/");
      await t.sleep(400);
    }
  } finally {
    t.close();
  }
}

// --- P4: a phone-only padding that the later stylesheet resets
if (wanted("P4")) {
  const t = await open();
  try {
    await press(t, "/^Phone/");
    await t.sleep(1500);
    await pick(t, "archive-strip", 2500);
    const RULE = ".archive__strip { position: sticky; top: 56px; padding: 12px var(--edge); background: var(--paper); }";
    const id = await change(t, "Only on phones: add 24px of padding above this heading.", {
      summary: "On phones the strip now gets 24px of top padding.",
      edits: [{ file: "style.css", find: RULE, replace: `${RULE}\n@media (max-width: 700px) { .archive__strip { padding-top: 24px; } }` }],
    });
    await t.sleep(5000); // the stylesheet updates on the page, and newer versions then look at it
    const j = await jobNow(t, id);
    const sent = lastSent();
    out.P4 = {
      width: await t.fev(`w.innerWidth`),
      paddingTopOnThePage: await t.fev(`w.getComputedStyle(d.querySelector('.archive__strip')).paddingTop`),
      claudeSaid: j.summary,
      thePageSaid: j.observed?.note ?? null,
      cardShows: (await cardText(t)).match(/On phones the strip now gets 24px of top padding\..{0,160}/)?.[0] ?? null,
      mobileCssRuleWasSentToClaude: /<file path="mobile\.css"/.test(sent) && /\.archive__strip \{ position: static; padding: 0; \}/.test(sent),
      requestChars: sent.length,
    };
  } finally {
    t.close();
  }
  writeFileSync(join(SITE, "style.css"), ORIGINAL["style.css"]);
}

// --- P2 and P3: a change adds a block with layers; then Undo
if (wanted("P2")) {
  let t = await open();
  try {
    await pick(t, "contact", 2000);
    const END = `<p><a href="mailto:hello@example.com">hello@example.com</a></p>\n</section>`;
    const id = await change(t, "Add a short FAQ block right after this section.", {
      summary: "Added a FAQ block after Contact.",
      edits: [{ file: "index.html", find: END, replace: `${END}\n\n<section class="band faq" ${TAG}="faq">\n  <h2 ${TAG}="faq-heading">Questions</h2>\n  <p ${TAG}="faq-item">How is it made? Slowly.</p>\n</section>` }],
      map: { add: [{ id: "faq", label: "FAQ", parent: "contact", kind: "section" }, { id: "faq-heading", label: "FAQ heading", parent: "faq", kind: "text" }, { id: "faq-item", label: "FAQ item", parent: "faq", kind: "text" }], remove: [] },
    });
    await t.sleep(1500);
    const P3 = { rightAfterTheChange: (await rows(t, "/^faq/")).length };
    await press(t, "/^Reload page$/"); // the banner's Reload: the page in the frame
    await t.sleep(2500);
    P3.afterTheBannerReload = (await rows(t, "/^faq/")).length;
    P3.reloadLayersOffered = await t.ev(`[...document.querySelectorAll('button')].some(b => /Reload layers/.test(b.textContent))`);
    t.close();
    t = await open(); // a full reload of the editor
    P3.afterAFullEditorReload = (await rows(t, "/^faq/")).length;
    P3.onThePage = await t.fev(`d.querySelectorAll('[${TAG}^="faq"]').length`);
    out.P3 = P3;

    await t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /changes/i.test(b.textContent))?.click()`);
    await t.sleep(500);
    const undone = await press(t, "/^Undo$/");
    await t.sleep(3000);
    const map = JSON.parse(file("inspector.map.json"));
    const check = await t.ev(`fetch('/__inspector/map-check').then(r => r.json()).then(d => d.check?.absent ?? [])`);
    const P2 = {
      undoPressed: undone,
      jobUndone: !!(await jobNow(t, id))?.undone,
      filesBack: file("index.html") === file("index.html").replace(/faq/g, "faq") && !file("index.html").includes("Questions"),
      rowsRightAfterUndo: (await rows(t, "/^faq/")).length,
      entriesLeftInTheMap: map.parts.filter((p) => /^faq/.test(p.id)).map((p) => `${p.id}${p.added ? " (added)" : ""}${p.removed ? " (removed)" : ""}`),
      serverSaysAbsent: check.filter((x) => /^faq/.test(x)),
    };
    await press(t, "/^Reload page$/");
    await t.sleep(2500);
    P2.rowsAfterTheBannerReload = (await rows(t, "/^faq/")).length;
    t.close();
    t = await open();
    P2.rowsAfterAFullEditorReload = (await rows(t, "/^faq/")).length;
    out.P2 = P2;
  } finally {
    t.close();
  }
}

// --- how long the editor takes to bring the pinned and the moving layers into view (the report's layer check)
if (wanted("searches")) {
  const t = await open();
  try {
    await t.sleep(3000);
    out.searches = [];
    for (const id of ["colony-spider", "prologue", "prologue-sub", "colony-cocoon", "drawer", "archive-strip"]) {
      const ms = await t.ev(`new Promise((done) => { const t0 = performance.now(); document.querySelector('button[data-layer="${id}"]')?.click(); let seen = false; const tick = () => { const on = !!document.querySelector('[data-seeking]'); seen = seen || on; const el = performance.now() - t0; if ((seen && !on) || (!seen && el > 150) || el > 30000) return done(Math.round(el)); requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`);
      await t.sleep(600);
      const shown = await t.fev(`(() => { const e = d.querySelector('[${TAG}="${id}"]'); if (!e) return null; const b = e.getBoundingClientRect(); return e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && b.width >= 2 && b.height >= 2 && b.bottom > 0 && b.top < w.innerHeight; })()`);
      out.searches.push({ layer: id, seconds: +(ms / 1000).toFixed(2), onScreenAfter: shown, footer: await t.status() });
    }
  } finally {
    t.close();
  }
}

server.kill();
if (arg("out")) writeFileSync(arg("out"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
