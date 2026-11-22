// What apply.mjs writes into a site's code for its layers (step 1, layer identity): the inspector's own attribute,
// nothing for a layer found by a selector, the site's own data-part left alone, and the one-time rename of the tags
// of a map made before the inspector had its own attribute.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const site = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "design-map-tags-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), typeof text === "string" ? text : JSON.stringify(text, null, 2));
  }
  return dir;
};
const script = (name, ...args) => spawnSync(process.execPath, [join(REPO, "scripts", name), ...args], { encoding: "utf8", env: { ...process.env, DESIGN_MAP_FORCE: "" } });
const read = (dir, f) => readFileSync(join(dir, f), "utf8");
const part = (id, more = {}) => ({ id, label: id, group: "Page", prompt: [{ where: "Page", text: id }], tokens: [], files: ["index.html"], edit: ["index.html"], ...more });
const map = (parts, more = {}) => ({ version: 1, name: "site", facts: ["x"], tokensFile: "index.html", extraFiles: [], groups: ["Page"], tokens: {}, parts, ...more });
const apply = (dir, m) => script("apply.mjs", dir, join(site({ "map.json": m }), "map.json"));
const page = (body, css = "") => `<!doctype html><html><head><style>:root { --ink: #111111; }\n${css}</style></head><body>${body}</body></html>\n`;

test("a site's own data-part is left alone, and its element can still be a layer (UI-1, UI-16)", () => {
  // the site tags its size buttons itself, and one of its values happens to equal a map id
  const dir = site({
    "index.html": page(`<section class="hero"><h1>Hello</h1></section><div class="sizes"><button class="size" data-part="medium">M</button><i data-part="hero"></i></div><script>document.querySelectorAll("[data-part]").forEach(() => {});</script>`),
  });
  const r = apply(dir, map([part("hero", { targets: [{ file: "index.html", find: 'class="hero"' }] }), part("size-medium", { targets: [{ file: "index.html", find: 'data-part="medium"' }] })]));
  assert.equal(r.status, 0, r.stderr);
  const html = read(dir, "index.html");
  assert.match(html, /<section data-dm="hero" class="hero">/);
  assert.match(html, /<button data-dm="size-medium" class="size" data-part="medium">/); // both sit on one element
  assert.match(html, /<i data-part="hero"><\/i>/); // not adopted, not removed
  assert.equal(JSON.parse(read(dir, "inspector.map.json")).tag, "data-dm");
  // again: nothing more to do
  assert.equal(apply(dir, JSON.parse(read(dir, "inspector.map.json"))).status, 0);
  assert.equal(read(dir, "index.html"), html);
});

test("a tag the map no longer asks for is removed; a part a change added keeps its tag", () => {
  const dir = site({ "index.html": page(`<section class="hero" data-dm="old-hero"><p data-dm="gone">x</p><em data-dm="badge">new</em></section>`) });
  const r = apply(dir, map([part("hero", { targets: [{ file: "index.html", find: 'class="hero"' }] }), part("badge", { added: true })]));
  assert.equal(r.status, 0, r.stderr);
  const html = read(dir, "index.html");
  assert.match(html, /<section class="hero" data-dm="hero"><p>x<\/p><em data-dm="badge">new<\/em><\/section>/);
});

test("a part found by a selector gets nothing written, and its selector is checked", () => {
  const body = `<section class="features"><div class="split"><h2 data-dm="features-title">Small rituals</h2></div></section>`;
  const dir = site({ "index.html": page(body) });
  const features = part("features", { targets: [{ file: "index.html", find: 'class="features"' }] });
  const title = (selector, more = {}) => part("features-title", { parent: "features", targets: [{ selector, ...more }] });
  for (const [bad, why] of [
    [title("[data-dm='features'] h2 { }"), /its selector .* can't be used: it has "\{"/],
    [title("[data-dm='pricing'] h2"), /"pricing" isn't a part of the map/],
    [title("[data-dm='features-title'] span"), /starts from its own tag/],
    [title("[data-dm='features'] h2", { file: "index.html", find: "<h2" }), /either a tag in the code .* or a selector/],
    [part("features-title", { targets: [{ file: "index.html" }] }), /needs "file" and "find" .* or "selector"/],
  ]) {
    const r = apply(dir, map([features, bad]));
    assert.equal(r.status, 1);
    assert.match(r.stderr, why);
    assert.equal(read(dir, "index.html"), page(body)); // a mistake in the map changes nothing
  }
  // a selector that starts from a part which is itself found by a selector would never apply on the real site
  let r = apply(dir, map([features, title("[data-dm='features'] h2"), part("word", { targets: [{ selector: "[data-dm='features-title'] span" }] })]));
  assert.match(r.stderr, /"features-title", which is itself found by a selector/);
  r = apply(dir, map([features, title("[data-dm='features'] h2")]));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 part is found on the page by a selector \(nothing written into the code\): features-title/);
  // the tag it once had is gone (the page would otherwise carry two answers for one layer)
  assert.match(read(dir, "index.html"), /<section data-dm="features" class="features"><div class="split"><h2>Small rituals<\/h2>/);
  // verify: fine as it is; and it says so when the selector starts from a tag the code doesn't have
  const ok = script("verify.mjs", dir, "--no-typecheck");
  assert.doesNotMatch(ok.stdout, /ERROR .*features-title/);
  const m = JSON.parse(read(dir, "inspector.map.json"));
  m.parts[1].targets = [{ selector: "[data-dm='nowhere'] h2" }];
  writeFileSync(join(dir, "inspector.map.json"), JSON.stringify(m));
  const bad = script("verify.mjs", dir, "--no-typecheck");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /features-title: its selector starts from data-dm="nowhere", which nothing in the code carries/);
});

test("a component target is refused with the way out: a selector address (MOOR-H1, UI-11)", () => {
  const dir = site({
    "package.json": { name: "site", dependencies: { vite: "8", react: "19" } },
    "vite.config.ts": `export default { plugins: [] };\n`,
    "src/App.tsx": `export function App() {\n  return (\n    <section className="features">\n      <SplitTitle text="Small rituals" />\n    </section>\n  );\n}\n`,
  });
  const src = (p) => part(p.id, { ...p, files: ["src/App.tsx"], edit: ["src/App.tsx"] });
  const features = src({ id: "features", targets: [{ file: "src/App.tsx", find: 'className="features"' }] });
  let r = apply(dir, map([features, src({ id: "features-title", targets: [{ file: "src/App.tsx", find: "<SplitTitle" }] })], { tokensFile: null }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is a component \(<SplitTitle>\).*Give the part a selector address instead/);
  r = apply(dir, map([features, src({ id: "features-title", targets: [{ selector: "[data-dm='features'] h2" }] })], { tokensFile: null }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(dir, "src/App.tsx"), /<section data-dm="features" className="features">\n      <SplitTitle text="Small rituals" \/>/);
});

// --- maps made before 16 Nov 2026: their tags were data-part

const OLD_BODY = `<section data-part="hero" class="hero"><h1>Hello</h1><em data-part="badge">new</em></section>`;
const OLD_CSS = `[data-part="hero"] {\n  --ink: #334455;\n}\n[data-part="hero"] h1 { letter-spacing: 0; }\n`;
const oldMap = () => map([part("hero", { targets: [{ file: "index.html", find: 'class="hero"' }] }), part("badge", { added: true })]);

test("an older map's data-part tags are renamed once, with the rules written for them", () => {
  const dir = site({ "index.html": page(OLD_BODY, OLD_CSS), "inspector.map.json": oldMap() });
  const r = apply(dir, oldMap());
  assert.equal(r.status, 0, r.stderr);
  const html = read(dir, "index.html");
  assert.doesNotMatch(html, /data-part/);
  assert.match(html, /<section data-dm="hero" class="hero"><h1>Hello<\/h1><em data-dm="badge">new<\/em><\/section>/);
  assert.match(html, /\[data-dm="hero"\] \{\n  --ink: #334455;\n\}\n\[data-dm="hero"\] h1 \{ letter-spacing: 0; \}/);
  assert.match(r.stdout, /renamed 4 old data-part tags and selectors to data-dm/);
  // after that the map says which name its tags use, so a data-part the site adds later is the site's own
  writeFileSync(join(dir, "index.html"), html.replace("<h1>", `<h1 data-part="hero">`));
  assert.equal(apply(dir, JSON.parse(read(dir, "inspector.map.json"))).status, 0);
  assert.match(read(dir, "index.html"), /<h1 data-part="hero">/);
});

test("an element that already carries a part's tag is that part, whatever its find matches now", () => {
  // an older map on a site that tags things data-part itself: finds written for bare tags, counted with "nth"
  const body = `<p><b data-part="project-name">Atlas</b> <b data-part="card-title">Draft</b> <b>plain</b></p><script>document.querySelectorAll("[data-part]");</script>`;
  const m = () => map([part("project-name", { targets: [{ file: "index.html", find: "<b>", nth: 0 }] }), part("card-title", { targets: [{ file: "index.html", find: "<b>", nth: 1 }] })]);
  const dir = site({ "index.html": page(body), "inspector.map.json": m() });
  let r = apply(dir, m());
  assert.equal(r.status, 0, r.stderr);
  const html = read(dir, "index.html");
  assert.match(html, /<b data-dm="project-name" data-part="project-name">Atlas<\/b> <b data-dm="card-title" data-part="card-title">Draft<\/b> <b>plain<\/b>/);
  // and again, now that the map is a renamed one: the tags decide, not "<b>" number 0 (which would be the plain one)
  r = apply(dir, JSON.parse(read(dir, "inspector.map.json")));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, "index.html"), html);
});

test("files from before the rename that come back are reported, and renamed again on request", () => {
  const dir = site({ "index.html": page(OLD_BODY, OLD_CSS), "inspector.map.json": oldMap() });
  assert.equal(apply(dir, oldMap()).status, 0);
  const renamed = JSON.parse(read(dir, "inspector.map.json"));
  // a History version from before the rename is restored: the files are old, the map (not part of History) is new
  writeFileSync(join(dir, "index.html"), page(OLD_BODY, OLD_CSS));
  const v = script("verify.mjs", dir, "--no-typecheck");
  assert.equal(v.status, 1);
  assert.match(v.stdout, /hero: the code carries the old tag data-part="hero".*run apply with --rename-old-tags/);
  const r = script("apply.mjs", dir, join(site({ "map.json": renamed }), "map.json"), "--rename-old-tags");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(read(dir, "index.html"), /data-part/);
  assert.match(read(dir, "index.html"), /<em data-dm="badge">new<\/em>/);
});

test("when the site uses data-part itself, the old tags stay and the new ones go next to them", () => {
  const body = `${OLD_BODY}<i data-part="count">3</i><script>const n = document.querySelector("[data-part]").dataset.part;</script>`;
  const dir = site({ "index.html": page(body, OLD_CSS), "inspector.map.json": oldMap() });
  const r = apply(dir, oldMap());
  assert.equal(r.status, 0, r.stderr);
  const html = read(dir, "index.html");
  assert.match(html, /<section data-dm="hero" data-part="hero" class="hero">/);
  assert.match(html, /<em data-dm="badge" data-part="badge">new<\/em>/);
  assert.match(html, /<i data-part="count">3<\/i>/);
  // the inspector's own saved values move to the new name; a rule someone else wrote keeps working through the old tag
  assert.match(html, /\[data-dm="hero"\] \{\n  --ink: #334455;\n\}\n\[data-part="hero"\] h1 \{ letter-spacing: 0; \}/);
  assert.match(r.stdout, /the site's own code uses data-part too/);
  // and a second run changes nothing
  assert.equal(apply(dir, JSON.parse(read(dir, "inspector.map.json"))).status, 0);
  assert.equal(read(dir, "index.html"), html);
});
