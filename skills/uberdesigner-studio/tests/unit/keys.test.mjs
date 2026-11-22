// Shortcuts by the sign on the key, on any keyboard layout (runtime/panel-src/inspector/keys.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { isKey } from "../../runtime/panel-src/inspector/keys.ts";

test("the sign typed is the sign meant on a Latin layout", () => {
  assert.equal(isKey({ key: "i", code: "KeyI" }, "i"), true);
  assert.equal(isKey({ key: "I", code: "KeyI" }, "i"), true);
  assert.equal(isKey({ key: "i", code: "KeyG" }, "i"), true, "Dvorak: the key that types i");
  assert.equal(isKey({ key: "c", code: "KeyI" }, "i"), false, "Dvorak: the key in QWERTY's i place types c");
  assert.equal(isKey({ key: "[", code: "Digit8" }, "["), true, "German: AltGr+8 types [");
  assert.equal(isKey({ key: "ü", code: "BracketLeft" }, "["), false, "German: ü is a letter, not a bracket");
});

test("on another alphabet the key's place is read", () => {
  assert.equal(isKey({ key: "ш", code: "KeyI" }, "i"), true, "Russian");
  assert.equal(isKey({ key: "Ш", code: "KeyI" }, "i"), true);
  assert.equal(isKey({ key: "х", code: "BracketLeft" }, "["), true);
  assert.equal(isKey({ key: "ъ", code: "BracketRight" }, "]"), true);
  assert.equal(isKey({ key: "ι", code: "KeyI" }, "i"), true, "Greek");
  assert.equal(isKey({ key: "ш", code: "KeyI" }, "["), false);
  assert.equal(isKey({ key: "я", code: "KeyZ" }, "i"), false);
});

test("named keys are never a sign", () => {
  assert.equal(isKey({ key: "Escape", code: "Escape" }, "i"), false);
  assert.equal(isKey({ key: "Dead", code: "KeyI" }, "i"), false);
});
