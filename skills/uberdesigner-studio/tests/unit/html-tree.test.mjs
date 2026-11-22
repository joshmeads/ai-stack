// Finding an element in an HTML source by its place under another (runtime/server/html-tree.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { attrOf, elementAt, plainWords } from "../../runtime/server/html-tree.ts";

const HTML = `<!doctype html><html><body>
<section data-dm="story" class="story">
  <div class="stage">
    <img class="pic" src="media/one.webp" alt="">
    <blockquote class="q">First <b>quote</b></blockquote>
    <svg class="mark" viewBox="0 0 10 10"><path d="M0 0"/><g><path d="M1 1"/></g></svg>
    <blockquote class="q is-b">Second&nbsp;quote</blockquote>
    <div class="deep"><div><blockquote class="q">Inside</blockquote></div></div>
    <blockquote class="q">Third quote</blockquote>
  </div>
  <!-- <blockquote class="q">in a comment</blockquote> -->
  <script>const s = "<blockquote>in a script</blockquote>";</script>
  <p>After</p>
</section>
<section data-dm="loose"><p>One<p>Two</section>
</body></html>`;
const from = (id) => HTML.lastIndexOf("<", HTML.indexOf(`data-dm="${id}"`));
const at = (id, ...steps) => elementAt(HTML, from(id), steps.map(([tag, nth, of]) => ({ tag, nth, of })));

test("an element is found by which of its siblings it is, level by level", () => {
  const q = at("story", ["div", 1, 1], ["blockquote", 2, 3]);
  assert.equal(q?.tag, "blockquote");
  assert.equal(attrOf(q.open, "class"), "q is-b");
  assert.equal(plainWords(q.text), "Second quote");
  assert.equal(HTML.slice(q.start, q.nameEnd), "<blockquote");
  assert.equal(at("story", ["div", 1, 1], ["blockquote", 3, 3])?.text, "Third quote");
});

test("nesting is followed: a tag of the same name deeper down isn't a sibling", () => {
  assert.equal(plainWords(at("story", ["div", 1, 1], ["div", 1, 1], ["div", 1, 1], ["blockquote", 1, 1])?.text ?? ""), "Inside");
});

test("pictures, drawings and what a drawing holds", () => {
  const img = at("story", ["div", 1, 1], ["img", 1, 1]);
  assert.equal(attrOf(img.open, "src"), "media/one.webp");
  assert.equal(at("story", ["div", 1, 1], ["svg", 1, 1])?.tag, "svg");
  assert.equal(at("story", ["div", 1, 1], ["svg", 1, 1], ["g", 1, 1], ["path", 1, 1])?.tag, "path");
});

test("comments and scripts don't count as markup", () => {
  assert.equal(plainWords(at("story", ["p", 1, 1])?.text ?? ""), "After");
  assert.equal(at("story", ["blockquote", 1, 1]), null);
});

test("another number of siblings than the page has: not found, never guessed", () => {
  assert.equal(at("story", ["div", 1, 1], ["blockquote", 2, 4]), null, "the page has four, the file three");
  assert.equal(at("story", ["div", 1, 1], ["blockquote", 4, 4]), null);
  assert.equal(at("story", ["div", 2, 2]), null);
});

test("a source that leaves end tags out can't be followed, and says so by finding nothing", () => {
  assert.equal(at("loose", ["p", 2, 2]), null);
});

test("words are compared as a person reads them", () => {
  assert.equal(plainWords("  Tom&nbsp;&amp;&nbsp;Jerry\n  say &quot;hi&quot; "), 'Tom & Jerry say "hi"');
});
