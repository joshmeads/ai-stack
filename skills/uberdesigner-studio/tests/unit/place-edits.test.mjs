// Placing an answer's edits in a file (runtime/server/slices.ts placeEdits). F2: the second edit in a sliced file was
// looked for in the whole file, where a find that was unique in the slices repeats.
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeEdits } from "../../runtime/server/slices.ts";

const RULE = "font-weight:600; font-size:16px;";
const text = `.a { ${RULE} }\n.b { ${RULE} }\n.title { color: red; }\n.price { ${RULE} }\n.c { ${RULE} }\n`;
const range = (piece) => ({ start: text.indexOf(piece), end: text.indexOf(piece) + piece.length, note: piece });
const source = { file: "page.html", whole: false, reason: "its CSS", ranges: [range(".title { color: red; }"), range(`.price { ${RULE} }`)] };

test("two edits in one sliced file both land inside the slices", () => {
  const out = placeEdits(text, [{ find: "color: red;", replace: "color: blue;" }, { find: RULE, replace: "font-weight:700; font-size:18px;" }], source);
  assert.equal(typeof out, "string");
  assert.ok(out.includes(".title { color: blue; }"));
  assert.ok(out.includes(".price { font-weight:700; font-size:18px; }"));
  assert.equal(out.split(RULE).length - 1, 3); // the three rules outside the slices are untouched
});

test("the order Claude lists the edits in doesn't matter", () => {
  const a = placeEdits(text, [{ find: RULE, replace: "X" }, { find: "color: red;", replace: "Y" }], source);
  const b = placeEdits(text, [{ find: "color: red;", replace: "Y" }, { find: RULE, replace: "X" }], source);
  assert.equal(a, b);
});

test("an edit that builds on an earlier one is made after it", () => {
  const out = placeEdits("one two three", [{ find: "two", replace: "2 and a half" }, { find: "a half", replace: "0.5" }], undefined);
  assert.equal(out, "one 2 and 0.5 three");
});

test("what can't be placed is refused with the reason", () => {
  assert.match(placeEdits(text, [{ find: RULE, replace: "X" }], undefined).why, /more than once/);
  assert.match(placeEdits(text, [{ find: "nowhere", replace: "X" }], source).why, /didn't match/);
  assert.match(placeEdits("abcdef", [{ find: "abcd", replace: "X" }, { find: "cdef", replace: "Y" }], undefined).why, /overlaps/);
  assert.match(placeEdits(text, [{ find: "", replace: "X" }], source).why, /empty/);
});
