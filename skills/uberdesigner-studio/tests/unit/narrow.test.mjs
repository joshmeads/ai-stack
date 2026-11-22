// When the editor says its window is too narrow (runtime/panel-src/inspector/narrow.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { EDITOR_MIN_WIDTH, coverDue, inClaudeApp } from "../../runtime/panel-src/inspector/narrow.ts";

const CLAUDE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/5.11492.5 Chrome/156.0.8078.75 Safari/537.36";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0";

test("the Claude app's browser is told from ordinary browsers by its user agent", () => {
  assert.equal(inClaudeApp(CLAUDE), true);
  for (const ua of [CHROME, SAFARI, FIREFOX, ""]) assert.equal(inClaudeApp(ua), false);
});

test("the cover is due only in the Claude app's browser, and only below the editor's width", () => {
  assert.equal(coverDue(CLAUDE, 741), true);
  assert.equal(coverDue(CLAUDE, EDITOR_MIN_WIDTH - 1), true);
  assert.equal(coverDue(CLAUDE, EDITOR_MIN_WIDTH), false);
  assert.equal(coverDue(CLAUDE, 1440), false);
});

test("an ordinary browser is never covered, however narrow its window", () => {
  for (const ua of [CHROME, SAFARI, FIREFOX]) assert.equal(coverDue(ua, 320), false);
});
