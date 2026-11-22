// The layer tree: the page decides nesting and order for the layers it carries, the map for the rest
// (runtime/panel-src/inspector/parts.ts)
import assert from "node:assert/strict";
import { test } from "node:test";

const part = (id, more = {}) => ({ id, label: id, group: "Page", prompt: [], tokens: [], files: ["index.html"], edit: ["index.html"], targets: [{ file: "index.html", find: id }], ...more });
const MAP = {
  version: 1, name: "Tree", facts: [], extraFiles: [], groups: ["Page"], tokens: {},
  parts: [
    part("hero"),
    part("title", { parent: "hero" }),
    part("lead", { parent: "title" }), // the map is wrong: on the page it sits beside the title
    part("elsewhere", { parent: "hero" }), // on another page
    part("extras", { targets: [] }), // a group the map made up: no element anywhere
    part("badge", { parent: "extras" }),
    part("footer"),
  ],
};
globalThis.__DESIGN_MAP__ = structuredClone(MAP);
const P = await import("../../runtime/panel-src/inspector/parts.ts");
const ids = (list) => list.map((p) => p.id);
const page = (order, parents) => ({ index: new Map(order.map((id, i) => [id, i])), parent: new Map(Object.entries(parents)) });

test("before a page is read, the map's parents and order hold", () => {
  assert.deepEqual(ids(P.childrenOf(null)), ["hero", "extras", "footer"]);
  assert.deepEqual(ids(P.childrenOf("hero")), ["title", "elsewhere"]);
  assert.deepEqual(ids(P.childrenOf("title")), ["lead"]);
  assert.equal(P.isNested(), true);
});

test("a layer on the page sits in the layer its element sits in, whatever the map says", () => {
  P.setPageTree(page(["hero", "title", "lead", "badge", "footer"], { hero: null, title: "hero", lead: "hero", badge: "hero", footer: null }));
  assert.deepEqual(ids(P.childrenOf("hero")), ["title", "lead", "elsewhere"]);
  assert.deepEqual(ids(P.childrenOf("title")), []);
  assert.deepEqual(ids(P.ancestorsOf("lead")), ["hero"]);
});

test("layers are listed in the order of the page; one that isn't on it keeps its place", () => {
  P.setPageTree(page(["footer", "hero", "lead", "title", "badge"], { hero: null, title: "hero", lead: "hero", badge: "hero", footer: null }));
  assert.deepEqual(ids(P.childrenOf(null)), ["footer", "extras", "hero"]);
  assert.deepEqual(ids(P.childrenOf("hero")), ["lead", "title", "elsewhere"]);
});

test("a layer stays in a parent that has no address, and one that isn't on the page in its map parent", () => {
  assert.deepEqual(ids(P.childrenOf("extras")), ["badge"]);
  assert.deepEqual(ids(P.ancestorsOf("elsewhere")), ["hero"]);
});

test("a parent the page names that the map doesn't know is nobody", () => {
  P.setPageTree(page(["hero", "title"], { hero: null, title: "ghost" }));
  assert.deepEqual(ids(P.ancestorsOf("title")), []);
  P.setPageTree(null);
  assert.deepEqual(ids(P.ancestorsOf("title")), ["hero"]);
});

test("a newer map is swapped in place: the same lists, the new layers, a higher revision", () => {
  const before = P.mapRev();
  const list = P.PARTS;
  let told = 0;
  const stop = P.subscribeMap(() => told++);
  P.replaceMap({ ...structuredClone(MAP), parts: [...structuredClone(MAP.parts), part("ribbon", { parent: "hero", group: "New" })] });
  stop();
  assert.equal(P.PARTS, list);
  assert.equal(P.partById("ribbon")?.label, "ribbon");
  assert.deepEqual(ids(P.childrenOf("hero")), ["title", "elsewhere", "ribbon"]);
  assert.ok(P.GROUPS.includes("New"), "a group a part names joins the groups");
  assert.ok(P.mapRev() > before);
  assert.equal(told, 1);
});

test("a map without parents and a page without nesting is the flat list, in page order within a group", () => {
  P.replaceMap({ version: 1, name: "Flat", groups: ["Page"], parts: [part("a"), part("b"), part("c")] });
  assert.equal(P.isNested(), false);
  P.setPageTree(page(["c", "a", "b"], { a: null, b: null, c: null }));
  assert.equal(P.isNested(), false);
  assert.deepEqual(ids(P.inGroup("Page")), ["c", "a", "b"]);
  assert.deepEqual(P.TOKENS, {}, "a field the map leaves out reads as empty");
});
