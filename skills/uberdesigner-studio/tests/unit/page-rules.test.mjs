// Claude's CSS context chosen from what the page says (runtime/server/slices.ts): the rules the panel listed are found
// in the site's files by selector and position, and sent in place of the match by class names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { render, resolveContext, rulesFromPage, sentChars } from "../../runtime/server/slices.ts";

// A page big enough to be sliced: the part (.card) among many unrelated rules that happen to mention its class
const filler = Array.from({ length: 220 }, (_, i) => `.other-${i} .card-wrap .label { margin: ${i}px; }`).join("\n");
const CSS = `:root { --ink: #111; --gap: 24px; }
@media (max-width: 600px) { :root { --gap: 12px; } }
@media (max-width: 900px) { :root { --unrelated: 1px; } }
.grid { display: grid; grid-template-columns: 1fr 1fr; }
.card { color: var(--ink); padding: var(--gap); animation: rise 1s; }
.card:hover { color: red; }
.card.is-open { outline: 1px solid; }
.sidebar .card .label { font-weight: 700; }
.card { border: 0; }
@media (max-width: 600px) { .card { padding: 8px; } }
@keyframes rise { from { opacity: 0; } to { opacity: 1; } }
${filler}
`;
const PAGE = `<!doctype html><html><head><style>\n${CSS}</style></head><body><div class="grid"><article data-dm="card" class="card"><p class="label">Hi</p></article></div></body></html>\n`;
const SECOND = `.card { padding: 0 !important; }\n.unrelated { color: blue; }\n${Array.from({ length: 300 }, (_, i) => `.x-${i} { top: ${i}px; }`).join("\n")}\n`;
const files = { "index.html": PAGE, "mobile.css": SECOND };
const view = (f) => files[f];
const part = { id: "card", edit: ["index.html"], tokens: ["--ink"] };
const map = { tokensFile: "index.html", extraFiles: [] };
const sliceNotes = (sources, file) => sources.find((s) => s.file === file)?.ranges.map((r) => r.note) ?? [];

test("a rule is found by its selector and its place among rules with that selector", () => {
  const { hits, missed } = rulesFromPage("index.html", PAGE, [
    { selector: ".card", nth: 0 },
    { selector: ".card", nth: 1 },
    { selector: ".card", nth: 2 }, // the one inside the phone media query
    { selector: ".sidebar .card > .label", nth: 0 }, // not in the file as named
    { selector: ".grid", nth: 0, around: true },
  ]);
  assert.equal(missed, 1);
  assert.deepEqual(hits.map((h) => h.rule.body.trim()), ["color: var(--ink); padding: var(--gap); animation: rise 1s;", "border: 0;", "padding: 8px;", "display: grid; grid-template-columns: 1fr 1fr;"]);
  assert.equal(hits[2].rule.media, "@media (max-width: 600px)");
  assert.equal(hits[3].around, true);
  // the browser's spelling and the source's compare equal
  assert.equal(rulesFromPage("a.css", `.a>.b:before,[x=y]{top:0}`, [{ selector: '.a > .b::before, [x="y"]', nth: 0 }]).hits.length, 1);
});

test("with the page's rules, Claude gets those: not every rule that mentions the part's class", () => {
  const guessed = resolveContext(part, "make it bolder", map, Object.keys(files), view);
  const page = new Map([
    ["index.html", [{ selector: ".card", nth: 0 }, { selector: ".card:hover", nth: 0 }, { selector: ".card", nth: 1 }, { selector: ".card", nth: 2 }, { selector: ".grid", nth: 0, around: true }]],
    ["mobile.css", [{ selector: ".card", nth: 0 }]],
  ]);
  const asked = resolveContext(part, "make it bolder", map, Object.keys(files), view, page);
  const notes = sliceNotes(asked, "index.html");
  // its own rules, the hover, the phone rule, the keyframes it plays, and the state the page can't show now
  for (const want of [/CSS \.card$/, /CSS \.card:hover/, /CSS \.card inside @media \(max-width: 600px\)/, /@keyframes rise/, /CSS \.card\.is-open/]) assert.ok(notes.some((n) => want.test(n)), `${want} in ${notes.join(" | ")}`);
  // the layout of the element around it (F5)
  assert.ok(notes.some((n) => /CSS \.grid \(lays out the element around it\)/.test(n)));
  // not the rules that only mention its class on the way to something else (fixes#3)
  assert.ok(!notes.some((n) => /\.sidebar \.card \.label|card-wrap/.test(n)), notes.join(" | "));
  assert.ok(sliceNotes(guessed, "index.html").some((n) => /\.sidebar \.card \.label/.test(n))); // the guess did send that one
  // the token blocks: the first, and the phone one that sets a value its rules use; not the unrelated breakpoint (U11)
  const text = render(asked, view);
  assert.ok(text.includes("--gap: 12px"));
  assert.ok(!text.includes("--unrelated"));
  assert.ok(render(guessed, view).includes("--unrelated"));
  // the second stylesheet's rule that wins over the first (VEYL-P4): that rule only, not the file
  assert.deepEqual(sliceNotes(asked, "mobile.css"), ["CSS .card (another stylesheet's rule for the same element)"]);
  assert.ok(!guessed.some((s) => s.file === "mobile.css"));
  assert.ok(sentChars(asked, view) < sentChars(guessed, view), `${sentChars(asked, view)} < ${sentChars(guessed, view)}`);
});

test("a shared rule that sets something the part's own rules don't is left out (it would cost tokens on every request)", () => {
  const withUtility = { ...files, "global.css": `.card { text-box-trim: trim-both; }\n.card { padding: 1px; }\n${"/* filler */\n".repeat(900)}` };
  const page = new Map([
    ["index.html", [{ selector: ".card", nth: 0 }]],
    ["global.css", [{ selector: ".card", nth: 0 }, { selector: ".card", nth: 1 }]],
  ]);
  const asked = resolveContext(part, "make it bolder", map, Object.keys(withUtility), (f) => withUtility[f], page);
  // the one that sets padding, as the part's own rule does; not the one that only trims the text box
  assert.equal(asked.find((s) => s.file === "global.css").ranges.length, 1);
  assert.ok(render(asked, (f) => withUtility[f]).includes("padding: 1px"));
  assert.ok(!render(asked, (f) => withUtility[f]).includes("text-box-trim"));
});

test("when the file doesn't have the rules as the page names them, the class names decide as before", () => {
  const page = new Map([["index.html", [{ selector: ".built-by-a-tool-1", nth: 0 }, { selector: ".built-by-a-tool-2", nth: 0 }]]]);
  const asked = resolveContext(part, "make it bolder", map, Object.keys(files), view, page);
  const guessed = resolveContext(part, "make it bolder", map, Object.keys(files), view);
  assert.deepEqual(sliceNotes(asked, "index.html"), sliceNotes(guessed, "index.html"));
});
