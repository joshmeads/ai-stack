// A layer's address (runtime/server/address.ts): the tag in the source, a selector asked of the page, and the rule a
// layer's own values are saved under.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TAG, addressNote, anchorsOf, hasTag, ruleRe, ruleSelector, selectorProblem, selectorsOf, tagRe, tagSelector, tagTargetsOf, tagsIn } from "../../runtime/server/address.ts";

const title = { id: "features-title", targets: [{ selector: "[data-dm='features']   h2" }] };
const hero = { id: "hero", targets: [{ file: "index.html", find: 'class="hero"' }] };
const sphere = { id: "sphere" };

test("the tag is the inspector's own attribute", () => {
  assert.equal(TAG, "data-dm");
  assert.equal(tagSelector("hero"), '[data-dm="hero"]');
});

test("tags are read from HTML and JSX, and the site's own attributes aren't", () => {
  const source = `<section data-dm="hero" data-part="reel"><Canvas data-dm={"scene"} /><p data-dm='lead'>x</p><i data-part="count"></i></section>`;
  assert.deepEqual(tagsIn(source), ["hero", "scene", "lead"]);
  assert.ok(hasTag(source, "hero"));
  assert.ok(!hasTag(`<section data-dm="hero-photo">`, "hero")); // a longer id isn't this one
  assert.ok(!hasTag(source, "reel"));
  assert.equal(source.replace(tagRe("lead"), ""), source.replace(" data-dm='lead'", ""));
});

test("a part is tagged, addressed, or neither", () => {
  assert.deepEqual(selectorsOf(hero), []);
  assert.equal(tagTargetsOf(hero).length, 1);
  assert.deepEqual(selectorsOf(title), [`[data-dm="features"] h2`]); // one spelling: single spaces, double quotes
  assert.equal(tagTargetsOf(title).length, 0);
  assert.deepEqual(selectorsOf(sphere), []);
  assert.deepEqual(anchorsOf("[data-dm='features'] h2, [data-dm=pricing] > .title"), ["features", "pricing"]);
});

test("a selector that could close its rule or the style block is refused", () => {
  for (const ok of ["[data-dm='features'] h2", ".card:nth-child(2) > .title", "#hero h1, #hero h2", "a[href^='/works']"]) assert.equal(selectorProblem(ok), null, ok);
  for (const [bad, why] of [
    ["", /empty/],
    ["h2 { color: red }", /"\{"/],
    ["h2; x", /";"/],
    ["h2 /* x */", /"\/\*"/],
    ["h2</style>", /"<"/],
    ["h2::before", /pseudo-element/],
    ["> h2", /combinator/],
    [".a:not(.b", /isn't closed/],
    ["a[href='x]", /quote/],
    ["h2\nh3", /line break/],
  ]) {
    assert.match(selectorProblem(bad) ?? "", why, bad);
  }
  assert.match(selectorProblem(undefined), /empty/);
});

test("a layer's own values go under its tag, or under its address", () => {
  assert.equal(ruleSelector(hero), '[data-dm="hero"]');
  assert.equal(ruleSelector(sphere), '[data-dm="sphere"]');
  assert.equal(ruleSelector(title), '[data-dm="features"] h2');
  // tagged at one size and addressed at another: one rule for both
  assert.equal(ruleSelector({ id: "cta", targets: [{ file: "a.html", find: "x" }, { selector: ".m-cta" }] }), '[data-dm="cta"], .m-cta');
});

test("that rule is found at the start of a rule only, however it's spaced or quoted", () => {
  const css = `:root { --a: 1; }
[data-dm="hero"] {
  --a: 2;
}
.dark [data-dm="hero"] { --a: 3; }
[data-dm="hero"] h2 { --a: 4; }
@media (max-width: 600px) {
  [data-dm='features']
    h2 { --a: 5; }
}`;
  assert.deepEqual([...css.matchAll(ruleRe(ruleSelector(hero)))].map((m) => m[0]), ['[data-dm="hero"] {\n  --a: 2;\n}']);
  assert.equal([...css.matchAll(ruleRe(ruleSelector(title)))].length, 1);
  assert.equal([...css.matchAll(ruleRe('[data-dm="hero"] h2'))].length, 1);
  assert.equal([...`[data-dm="hero"]{--a:1}`.matchAll(ruleRe('[data-dm="hero"]'))].length, 1); // first thing in the file
});

test("Claude is told which element an addressed part is, and nothing for a tagged one", () => {
  assert.equal(addressNote(hero, () => undefined), "");
  const note = addressNote(title, (id) => (id === "features" ? "Features" : undefined));
  assert.match(note, /the element matching `\[data-dm="features"\] h2` \(inside Features\)/);
  assert.match(note, /no data-dm tag of its own in the code: don't add one/);
  assert.ok(note.length < 260); // about 60 tokens
});
