// The value check every CSS value passes before it's written (runtime/server/values.ts). VEYL-P5: a colour field took
// `notacolor`, `#12345` and `rgb(0,0`, and Save wrote them into the stylesheet.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bracesBalance, colorShaped, unsafeValue, valueProblem } from "../../runtime/server/values.ts";

test("a value that would leave its declaration is refused", () => {
  for (const v of ["rgb(0,0", "red; color: blue", "red } body { display: none", "</style><script>", "url('a", "calc(1px + (2px)", "a)", "1px /* note", "line\nbreak", "", "  ", "back\\"]) {
    assert.notEqual(unsafeValue(v), null, JSON.stringify(v));
  }
});

test("a semicolon or brace is refused even inside quotes: the inspector's own writers read a value up to the next one", () => {
  assert.notEqual(unsafeValue(`url("a;b.png")`), null);
  assert.notEqual(unsafeValue(`"}"`), null);
});

test("ordinary values pass", () => {
  for (const v of ["#111", "24px", "calc(18 * var(--u))", "clamp(1rem, 2vw + 1rem, 3rem)", "rgb(0 0 0 / 0.32)", "0.45s", "cubic-bezier(0.2, 0.8, 0.2, 1)", `"Inter", sans-serif`, "url(\"a b.png\")", "1px solid rgba(0,0,0,.1)", "var(--ink, #000)", "red !important"]) {
    assert.equal(unsafeValue(v), null, v);
  }
});

test("what's written as a colour", () => {
  for (const v of ["#fff", "#ffff", "#12ab56", "#12ab5680", "rgb(0, 0, 0)", "rgb(0 0 0 / .3)", "hsl(210 40% 50%)", "oklch(0.7 0.1 200)", "color-mix(in srgb, red 40%, blue)", "rebeccapurple", "Transparent", "currentColor", "var(--ink)", "inherit"]) assert.ok(colorShaped(v), v);
  for (const v of ["notacolor", "#12345", "#12", "#ggg", "12px", "rgb", "rgb(0,0", "ink black"]) assert.ok(!colorShaped(v), v);
});

test("a colour stays a colour; other kinds only need to be safe", () => {
  assert.match(valueProblem("notacolor", "#111111") ?? "", /isn't a colour/);
  assert.match(valueProblem("#12345", "rgb(10, 10, 10)") ?? "", /isn't a colour/);
  assert.match(valueProblem("rgb(0,0", "#111111") ?? "", /isn't closed/);
  assert.equal(valueProblem("#222", "#111111"), null);
  assert.equal(valueProblem("var(--other)", "#111111"), null);
  assert.equal(valueProblem("2rem", "24px"), null);
  assert.equal(valueProblem("anything goes", "var(--ink)"), null); // a var() can hold any kind
  assert.equal(valueProblem("Georgia, serif", undefined), null);
});

test("braces pair up, comments and quoted text aside", () => {
  assert.ok(bracesBalance(`a { b: c } @media x { d { e: "}" } } /* } */`));
  assert.ok(!bracesBalance(`a { b: rgb(0,0; } c { d: e }`.replace("; }", ";")));
  assert.ok(!bracesBalance("a { b: c } }"));
});
