// Running a command for the inspector (runtime/server/site.ts, exec): git for History, Claude Code for a change.
// The server stopped on GitHub's Linux now and then, mid-save: a command that ends without reading what it was sent
// closes its input first, the write to it fails ("write EPIPE"), and nothing was listening for that error, which
// ends the whole server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exec } from "../../runtime/server/site.ts";

test("a command that ends without reading its input is a result, not a crash", async () => {
  // far more than a pipe holds, so the write is still going when the command has gone
  const r = await exec(process.execPath, ["-e", "process.exit(3)"], { input: "x".repeat(5_000_000), cwd: process.cwd() });
  assert.equal(r.code, 3);
});

test("a command that can't be started is a result too", async () => {
  const r = await exec("/no/such/command", [], { input: "hello", cwd: process.cwd() });
  assert.equal(r.code, -1);
});

test("what a command is sent reaches it, and what it prints comes back", async () => {
  const r = await exec(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "hello", cwd: process.cwd() });
  assert.deepEqual([r.code, r.out], [0, "hello"]);
  const none = await exec(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { cwd: process.cwd() });
  assert.deepEqual([none.code, none.out], [0, ""]);
});
