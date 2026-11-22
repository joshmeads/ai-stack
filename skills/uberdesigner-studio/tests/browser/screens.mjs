#!/usr/bin/env node
// The editor's screens, photographed the same way every time, so a change to how the studio looks can be put side by
// side with the version before it (the redesign: the same script run on main and on the branch, one folder each).
// A tiny two-page site with pictures is built in a temporary folder, the studio of the chosen checkout is installed by
// its own apply.mjs, and its server runs with a stand-in for Claude Code (nothing is sent to Claude). Each screen is a
// PNG at 1600 × 1000, named by number so the two folders line up; a screen that can't be reached is listed, not drawn.
//   node tests/browser/screens.mjs --out <folder> [--skill <checkout>] [--theme light|dark]     needs Google Chrome; about 40 s
// --theme picks the studio's theme before the first screen (versions before the redesign have only dark).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor, sleep } from "../sites/cdp.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = resolve(arg("--out") ?? "screens");
const THEME = arg("--theme");
const SKILL = resolve(arg("--skill") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
mkdirSync(OUT, { recursive: true });

// --- The site: a header, a hero with a picture, three cards with pictures, a footer; a second page linked from both
const SITE = mkdtempSync(join(tmpdir(), "design-map-screens-"));
const CAPTURE = mkdtempSync(join(tmpdir(), "design-map-screens-capture-"));
const picture = (a, b, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="560" cy="220" r="120" fill="rgba(255,255,255,0.35)"/><text x="48" y="552" font-family="Helvetica, Arial" font-size="40" fill="#fff">${label}</text></svg>`;
writeFileSync(join(SITE, "hero.svg"), picture("#1d3557", "#e76f51", "Hero"));
writeFileSync(join(SITE, "card-1.svg"), picture("#2a9d8f", "#264653", "Linen"));
writeFileSync(join(SITE, "card-2.svg"), picture("#e9c46a", "#f4a261", "Clay"));
writeFileSync(join(SITE, "card-3.svg"), picture("#6d597a", "#b56576", "Glass"));
const TITLE = ".hero h1 { font-size: 72px; line-height: 1; margin: 0 0 20px; color: var(--ink); }";
writeFileSync(
  join(SITE, "style.css"),
  `:root { --ink: #161616; --paper: #f6f3ee; --accent: #c2410c; --gap: 24px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Helvetica, Arial, sans-serif; color: var(--ink); background: var(--paper); }
.top { display: flex; justify-content: space-between; align-items: center; padding: 20px 48px; }
.top nav a { margin-left: 24px; color: var(--ink); text-decoration: none; }
.hero { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; padding: 48px; }
${TITLE}
.hero p { font-size: 18px; line-height: 1.5; margin: 0 0 28px; max-width: 420px; }
.hero .cta { display: inline-block; padding: 14px 24px; border-radius: 999px; background: var(--accent); color: #fff; text-decoration: none; }
.hero img { width: 100%; border-radius: 16px; display: block; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap); padding: 48px; }
.card img { width: 100%; border-radius: 12px; display: block; }
.card h3 { margin: 14px 0 6px; }
.foot { padding: 32px 48px; border-top: 1px solid #ddd; font-size: 14px; }
@media (max-width: 700px) { .hero, .cards { grid-template-columns: 1fr; padding: 24px; } .hero h1 { font-size: 44px; } }
`,
);
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="style.css"></head><body>
<header class="top"><strong class="brand">Atelier Nord</strong><nav class="menu"><a href="/">Home</a><a href="/about.html">About us</a></nav></header>
${body}
<footer class="foot"><small>Atelier Nord · Since 1962</small></footer>
</body></html>
`;
writeFileSync(
  join(SITE, "index.html"),
  page(
    "Atelier Nord",
    `<section class="hero"><div class="hero-copy"><h1 class="title">Made slowly, kept for years.</h1><p>Furniture and objects from a small workshop by the sea.</p><a class="cta" href="/about.html">Visit the workshop</a></div><img class="hero-photo" src="hero.svg" alt="The workshop"></section>
<section class="cards"><article class="card"><img src="card-1.svg" alt=""><h3>Linen</h3><p>Woven in the north.</p></article><article class="card"><img src="card-2.svg" alt=""><h3>Clay</h3><p>Fired by hand.</p></article><article class="card"><img src="card-3.svg" alt=""><h3>Glass</h3><p>Blown one by one.</p></article></section>`,
  ),
);
writeFileSync(join(SITE, "about.html"), page("About · Atelier Nord", `<section class="hero"><div class="hero-copy"><h1>About us</h1><p>Three people, one long table.</p></div></section>`));
const part = (id, label, group, find, extra = {}) => ({
  id,
  label,
  group,
  prompt: [{ where: "index.html", text: label }],
  tokens: ["--ink"],
  files: ["index.html", "style.css"],
  edit: ["index.html", "style.css"],
  targets: [{ file: "index.html", find }],
  ...extra,
});
const map = {
  version: 1,
  name: "Atelier Nord",
  facts: [],
  tokensFile: "style.css",
  extraFiles: [],
  groups: ["Header", "Hero", "Cards", "Footer"],
  tokens: {
    "--ink": { kind: "color", role: "Colors › ink: text" },
    "--paper": { kind: "color", role: "Colors › paper: the page" },
    "--accent": { kind: "color", role: "Colors › accent: the button" },
    "--gap": { kind: "size", role: "Spacing › gap between cards" },
  },
  parts: [
    part("header", "Header", "Header", 'class="top"', { kind: "section" }),
    part("menu", "Menu", "Header", 'class="menu"', { parent: "header", kind: "list" }),
    part("hero", "Hero", "Hero", 'class="hero"', { kind: "section" }),
    part("hero-title", "Hero headline", "Hero", 'class="title"', { parent: "hero", kind: "text" }),
    part("hero-cta", "Visit button", "Hero", 'class="cta"', { parent: "hero", kind: "button" }),
    part("hero-photo", "Hero photo", "Hero", 'class="hero-photo"', { parent: "hero", kind: "image" }),
    part("cards", "Cards", "Cards", 'class="cards"', { kind: "section" }),
    part("foot", "Footer", "Footer", 'class="foot"', { kind: "section" }),
  ],
};
writeFileSync(join(SITE, "map.draft.json"), JSON.stringify(map));
const applied = spawnSync(process.execPath, [join(SKILL, "scripts", "apply.mjs"), SITE, join(SITE, "map.draft.json")], { encoding: "utf8" });
if (applied.status !== 0) {
  console.error(applied.stderr || applied.stdout);
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
  env: { ...process.env, CLAUDE_BIN: join(SKILL, "tests", "sites", "fake-claude.mjs"), CAPTURE_DIR: CAPTURE },
  stdio: "ignore",
});
await sleep(1500);

// --- The screens
const base = `http://localhost:${port}`;
const t = await openEditor(`${base}/__inspector/editor`);
const missed = [];
const shot = async (name) => {
  await t.sleep(700);
  const { data } = await t.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`saved ${name}.png`);
};
// A button by its words (a regular expression's source), first one that isn't disabled; false when there is none
const press = (re) => t.ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /${re}/.test(b.textContent.trim()) && !b.disabled); if (!b) return false; b.click(); return true; })()`);
const tab = (re) => t.ev(`(() => { const b = [...document.querySelectorAll('button[role=tab]')].find(b => /${re}/.test(b.textContent.trim())); if (!b) return false; b.click(); return true; })()`);
const pick = (id) => t.ev(`(() => { const b = document.querySelector('button[data-layer="${id}"]'); if (!b) return false; b.click(); return true; })()`);
const step = async (name, fn) => {
  try {
    if ((await fn()) === false) throw new Error("its control isn't there");
    await shot(name);
  } catch (err) {
    missed.push(`${name}: ${err.message}`);
    console.log(`missed ${name}: ${err.message}`);
  }
};

try {
  if (THEME) {
    await t.ev(`(localStorage.setItem("uberdesigner-studio-theme", ${JSON.stringify(THEME)}), location.reload(), true)`);
    await t.sleep(1000);
    for (let i = 0; i < 80 && !(await t.ev(`document.querySelectorAll('button[data-layer]').length`).catch(() => 0)); i++) await t.sleep(250);
  }
  await t.sleep(2500);
  await step("01-editor-at-rest", async () => true);
  await step("02-section-picked", () => pick("hero"));
  await step("03-text-picked", () => pick("hero-title"));
  await step("04-image-picked", () => pick("hero-photo"));
  await step("05-assets", () => tab("^Assets"));
  await step("06-pages", () => tab("^Pages"));
  await step("07-history", () => tab("^History"));
  await tab("^Layers");
  // A finished AI change on the headline: Claude's answer is scripted
  await step("08-ai-change-done", async () => {
    writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify({ summary: "The headline is now in the accent colour. Done.", edits: [{ file: "style.css", find: TITLE, replace: TITLE.replace("var(--ink)", "var(--accent)") }], create: [] }));
    if (!(await pick("hero-title"))) return false;
    await t.sleep(500);
    await t.ev(`(() => { const a = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(a, 'Make the headline the accent colour'); a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await t.sleep(300);
    if (!(await press("^(Run|Queue)$"))) return false;
    for (let i = 0; i < 60; i++) {
      await t.sleep(400);
      const jobs = await t.ev(`fetch('/__inspector/jobs').then(r => r.json()).then(d => d.jobs)`);
      if (jobs.some((j) => j.state === "done" || j.state === "error")) break;
    }
    await t.sleep(1200);
    return tab("AI changes");
  });
  await step("09-history-after-change", () => tab("^History"));
  await tab("^Layers");
  await tab("^Elements");
  await t.key("Escape", "Escape", 27);
  await t.key("Escape", "Escape", 27);
  await step("10-whole-site-request", () => press("^How it works$"));
  await press("^Hide$");
  await step("11-phone", () => press("^Phone"));
  await step("12-tablet", () => press("^Tablet"));
  await press("^Desktop\\s*1440");
  await step("13-preview", () => press("^Preview$"));
  // Out of the preview: Back to editor (the redesign's full view), or the same button again (versions before it)
  if (!(await press("^Back to editor"))) await press("^(Stop preview|Preview)$");
  // The redesign's own screens (a version without them lists them as missed)
  await step("15-focus-mode", () => press("^Focus$"));
  await step("16-about-card", () => t.ev(`(() => { const b = document.querySelector('button[aria-label="About uberdesigner"]'); if (!b) return false; b.click(); return true; })()`));
  await t.key("Escape", "Escape", 27);
  await press("^Design$");
  // The site's own address: before the redesign the plain site with its Inspect button, now the studio on that page
  await step("14-site-address", async () => {
    await t.send("Page.navigate", { url: `${base}/about.html` });
    await t.sleep(3500);
    return true;
  });
  // Back in the editor: the change kept, and where it rests
  await step("17-resolved", async () => {
    await t.send("Page.navigate", { url: `${base}/__inspector/editor` });
    for (let i = 0; i < 80 && !(await t.ev(`document.querySelectorAll('button[data-layer]').length`).catch(() => 0)); i++) await t.sleep(250);
    await t.sleep(1500);
    await tab("AI changes");
    await t.sleep(400);
    if (!(await press("^Keep$"))) return false;
    await t.sleep(1200);
    return tab("^Resolved");
  });
} finally {
  t.close();
  server.kill();
}
writeFileSync(join(OUT, "missed.txt"), missed.length ? missed.join("\n") + "\n" : "");
console.log(`${missed.length ? `${missed.length} screens missed (missed.txt)` : "all screens saved"} → ${OUT}`);
