// Writing values into a stylesheet as text (runtime/server/css-write.ts): a layer's own rule, and the checks around it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cssIntact, htmlStyleEnd, savePartTokens, setDeclaration } from "../../runtime/server/css-write.ts";

const CSS = `:root {\n  --ink: #111111;\n  --gap: 24px;\n}\n@media (max-width: 600px) {\n  :root {\n    --gap: 12px;\n  }\n}\n`;
const hero = { id: "hero", label: "Hero" };

test("a declaration is replaced where it is, or added before the closing brace", () => {
  assert.equal(setDeclaration("[data-dm=\"a\"] {\n  --ink: red;\n}", "--ink", "blue"), "[data-dm=\"a\"] {\n  --ink: blue;\n}");
  assert.equal(setDeclaration("[data-dm=\"a\"] {\n  --ink: red;\n}", "--gap", "8px"), "[data-dm=\"a\"] {\n  --ink: red;\n  --gap: 8px;\n}");
  // a longer name that ends the same way is another declaration
  assert.equal(setDeclaration("a {\n  --big-gap: 1px;\n}", "--gap", "2px"), "a {\n  --big-gap: 1px;\n  --gap: 2px;\n}");
});

test("a layer's first own value makes its rule after the tokens; the next one goes into the same rule", () => {
  const once = savePartTokens("tokens.css", CSS, hero, { "--ink": "#334455" });
  assert.ok(once.startsWith(CSS.trimEnd()));
  assert.match(once, /\/\* Set for one layer in uberdesigner studio \*\/\n\[data-dm="hero"\] \{\n  --ink: #334455;\n\}\n$/);
  const twice = savePartTokens("tokens.css", once, hero, { "--ink": "#556677" });
  assert.equal(twice.match(/\[data-dm="hero"\] \{/g).length, 1);
  assert.match(twice, /--ink: #556677;/);
});

test("a token with a phone value keeps that value on phones for the layer", () => {
  const out = savePartTokens("tokens.css", CSS, hero, { "--gap": "40px" });
  assert.match(out, /\[data-dm="hero"\] \{\n  --gap: 40px;\n\}/);
  assert.match(out, /@media \(max-width: 600px\) \{\n  \[data-dm="hero"\] \{\n    --gap: 12px;\n  \}\n\}/);
  // and the layer's own phone value, once it has one, is left alone
  const again = savePartTokens("tokens.css", out.replace("    --gap: 12px;\n  }\n}\n$", ""), hero, { "--gap": "48px" });
  assert.equal(again.match(/--gap: 12px;/g).length, 2); // the site's, and the layer's
});

test("an inherited property that reads a token again is accepted; anything else isn't a value", () => {
  assert.match(savePartTokens("tokens.css", CSS, hero, { "--ink": "#000000", "font-size": "var(--ink)" }), /font-size: var\(--ink\);/);
  assert.throws(() => savePartTokens("tokens.css", CSS, hero, { "font-size": "40px" }), /Not a token value/);
  assert.throws(() => savePartTokens("tokens.css", CSS, hero, { "--ink": "red; } body { display: none" }), /Not a token value/);
  assert.throws(() => savePartTokens("tokens.css", CSS, { id: "he ro" }, { "--ink": "red" }), /Not a part id/);
});

test("a layer found by a selector is saved under the selector, and a bad selector stops the save", () => {
  const title = { id: "title", label: "Title", targets: [{ selector: "[data-dm='features'] h2" }] };
  assert.match(savePartTokens("tokens.css", CSS, title, { "--ink": "#123456" }), /\n\[data-dm="features"\] h2 \{\n  --ink: #123456;\n\}/);
  assert.throws(() => savePartTokens("tokens.css", CSS, { id: "x", label: "X", targets: [{ selector: "h2 { } body" }] }, { "--ink": "red" }), /its address in the map .* can't be used/);
});

test("in an HTML page the rule goes into the <style> that holds the tokens, never one the page ignores", () => {
  const page = `<html><head><style>body { margin: 0; }</style><style>:root { --ink: #111111; }</style></head><body><noscript><style>.x { display: none; }</style></noscript><svg><style>.y { fill: red; }</style></svg></body></html>`;
  const end = htmlStyleEnd(page);
  assert.equal(page.slice(end, end + 8), "</style>");
  assert.ok(page.slice(0, end).endsWith(":root { --ink: #111111; }"));
  const out = savePartTokens("index.html", page, hero, { "--ink": "#334455" });
  assert.match(out, /:root \{ --ink: #111111; \}\n\n\/\* Set for one layer in uberdesigner studio \*\/\n\[data-dm="hero"\] \{\n  --ink: #334455;\n\}\n<\/style><\/head>/);
  assert.throws(() => savePartTokens("index.html", "<html><body><p>no styles</p></body></html>", hero, { "--ink": "red" }), /no <style> block to save into/);
});

test("a write that would leave a rule open is caught", () => {
  assert.ok(cssIntact("a.css", "a { b: c; }", "a { b: d; }"));
  assert.ok(!cssIntact("a.css", "a { b: c; }", "a { b: d; "));
  assert.ok(cssIntact("a.css", "a { b: c; ", "a { b: d; ")); // it was already open before: not this write's doing
});
