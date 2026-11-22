// Naming a picked object (runtime/panel-src/inspector/names.ts)
import assert from "node:assert/strict";
import { test } from "node:test";

import { fileWords, once } from "../../runtime/panel-src/inspector/names.ts";

test("a line that repeats one phrase is named by the phrase", () => {
  assert.equal(once("70 videos 70 videos 70 videos 70 videos"), "70 videos");
  assert.equal(once("5 years 5 years 5 years 5"), "5 years");
  assert.equal(once("go go go"), "go");
});

test("ordinary words are left as they are", () => {
  assert.equal(once("I stopped creating content that revolved only around my interests."), "I stopped creating content that revolved only around my interests.");
  assert.equal(once("the more the merrier"), "the more the merrier");
  assert.equal(once("Hello"), "Hello");
  assert.equal(once(""), "");
});

test("a file name that is a hash or an id is no name", () => {
  assert.equal(fileWords("e5346ab8 e16d 4b8c bd18 c15b5cc27a01"), "");
  assert.equal(fileWords("IMG 20261104 183022"), "");
  assert.equal(fileWords("hero v3 first"), "hero v3 first");
  assert.equal(fileWords("award"), "award");
});
