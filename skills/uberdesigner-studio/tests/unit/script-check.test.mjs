// Which scripts a file holds and how each is parsed (runtime/server/script-check.ts), shared by the check after a
// change and by verify.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { scriptsIn } from "../../runtime/server/script-check.ts";

test("an HTML page: its inline scripts, not the ones with a src, not data blocks", () => {
  const page = `<script src="a.js"></script><script>const a = 1;</script><script type="module">import x from "./x.js";</script><script type="application/json">{"a":1}</script><script type="x-shader/x-fragment">void main() {}</script>`;
  const found = scriptsIn("index.html", page);
  assert.deepEqual(found.map((s) => [s.name, s.module, s.code]), [["index.html script 1", false, "const a = 1;"], ["index.html script 2", true, 'import x from "./x.js";']]);
});

test("a .js file with import or export is a module (a Cloudflare worker), a plain one isn't (F15)", () => {
  assert.equal(scriptsIn("worker/index.js", "export default {\n  async fetch() {}\n};\n")[0].module, true);
  assert.equal(scriptsIn("app.js", "const exportName = 1;\nconsole.log('import this');\n")[0].module, false);
  assert.equal(scriptsIn("app.mjs", "const a = 1;")[0].module, true);
  assert.deepEqual(scriptsIn("styles.css", "a { }"), []);
});
