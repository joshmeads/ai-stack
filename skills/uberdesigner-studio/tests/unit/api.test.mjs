// The API end to end on a tiny site with no build step: the inspector installed as apply installs it, its own server
// started, and a stand-in for Claude Code (nothing is ever sent to Claude). Checks the three boundaries of step 0:
// who may call the API, what a save may write, and that a big file is never sent whole unasked. And of step 1: a
// layer found by a selector saves under that selector and tells Claude which element it is, and a value for a layer
// with no element is refused.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = mkdtempSync(join(tmpdir(), "design-map-api-"));
const CAPTURE = mkdtempSync(join(tmpdir(), "design-map-capture-"));
const PAGE = `<!doctype html>
<html><head><title>Tiny</title>
<style>
:root { --ink: #111111; --gap: 24px; }
.hero { color: var(--ink); padding: var(--gap); }
</style></head>
<body><section class="hero"><h1>Hello there</h1></section>
<script src="small.js"></script><script src="big.js"></script></body></html>
`;
const MAP = {
  version: 1, name: "Tiny", facts: [], tokensFile: "index.html", extraFiles: [], groups: ["Page"],
  tokens: { "--ink": { kind: "color", role: "Text colour", label: "Ink black" }, "--gap": { kind: "size", role: "Spacing", label: "Gap" } },
  parts: [
    { id: "hero", label: "Hero", group: "Page", prompt: [{ where: "Page", text: "A hero." }], tokens: ["--ink", "--gap"], files: ["index.html"], edit: ["index.html"], targets: [{ file: "index.html", find: 'class="hero"' }] },
    // found on the page by a selector: nothing in the code is tagged for it
    { id: "hero-title", label: "Hero title", group: "Page", parent: "hero", prompt: [{ where: "Page", text: "The headline." }], tokens: ["--ink"], files: ["index.html"], edit: ["index.html"], targets: [{ selector: "[data-dm='hero'] h1" }] },
    // no element at all (a piece inside a canvas)
    { id: "spark", label: "Spark", group: "Page", parent: "hero", outline: false, prompt: [{ where: "Page", text: "A spark." }], tokens: ["--ink"], files: ["index.html"], edit: ["index.html"] },
  ],
};

let server;
let port;
let token;
const page = () => readFileSync(join(SITE, "index.html"), "utf8");
const captures = () => readdirSync(CAPTURE).filter((f) => f !== "answer.json").length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One request with exactly these headers (fetch won't let a test set Host or Origin)
const call = (method, path, { headers = {}, body } = {}) =>
  new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          /* a page, not JSON */
        }
        done({ status: res.statusCode, data, text });
      });
    });
    req.on("error", fail);
    req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  });
const post = (path, body, headers = {}) => call("POST", path, { body, headers: { "content-type": "application/json", "x-inspector-token": token, ...headers } });

before(async () => {
  writeFileSync(join(SITE, "index.html"), PAGE);
  writeFileSync(join(SITE, "small.js"), "const greeting = 'hello';\n");
  writeFileSync(join(SITE, "big.js"), `// a big script\n${"const filler = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';\n".repeat(1200)}`);
  const mapDir = mkdtempSync(join(tmpdir(), "design-map-map-"));
  writeFileSync(join(mapDir, "map.json"), JSON.stringify(MAP));
  const applied = spawnSync(process.execPath, [join(REPO, "scripts", "apply.mjs"), SITE, join(mapDir, "map.json")], { encoding: "utf8" });
  assert.equal(applied.status, 0, applied.stderr);
  port = await new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
  await startServer();
});
async function startServer() {
  server = spawn(process.execPath, [join(SITE, ".inspector", "tool", "server", "serve.ts"), "--port", String(port)], {
    cwd: SITE,
    env: { ...process.env, CLAUDE_BIN: join(REPO, "tests", "sites", "fake-claude.mjs"), CAPTURE_DIR: CAPTURE, DESIGN_MAP_TOTALS_DIR: process.env.DESIGN_MAP_TOTALS_DIR ?? mkdtempSync(join(tmpdir(), "design-map-totals-")) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // A server that stops by itself says how it ended and what it printed last: the tests after it otherwise only show
  // "socket hang up" and "connection refused". This suite's own kill ends it cleanly (exit code 0) and isn't reported.
  let said = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (c) => (said = (said + c).slice(-8000)));
  server.on("exit", (code, signal) => {
    if (code === 0 || signal === "SIGTERM") return;
    console.log(`\nThe inspector's server stopped by itself (exit code ${code}, signal ${signal}). ${said.trim() ? `What it printed last:\n${said.trim()}` : "It printed nothing."}\n`);
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await call("GET", "/")).status === 200) break;
    } catch {
      /* starting */
    }
    await sleep(100);
  }
  token = readFileSync(join(SITE, ".inspector", "token"), "utf8").trim();
}
after(() => server?.kill());

test("the page gets the panel and the token; the token file is the same one", async () => {
  const home = await call("GET", "/");
  assert.match(home.text, /window\.__INSPECTOR_TOKEN__ = "[0-9a-f]{48}"/);
  assert.ok(home.text.includes(token));
  assert.equal((await call("GET", "/__inspector/editor")).status, 200);
  assert.equal((await call("GET", "/__inspector/jobs")).status, 200);
});

test("requests from elsewhere are refused and change nothing", async () => {
  const body = { tokens: { "--ink": "#abcdef" } };
  const refused = [
    await call("POST", "/__inspector/save", { body, headers: { "content-type": "application/json" } }), // no token
    await call("POST", "/__inspector/save", { body: JSON.stringify(body), headers: { "content-type": "text/plain" } }), // a plain form post from another site
    await post("/__inspector/save", body, { origin: "https://evil.example" }),
    await post("/__inspector/save", body, { "sec-fetch-site": "cross-site" }),
    await post("/__inspector/save", body, { host: "evil.example" }), // a foreign name pointed at this computer
    await post("/__inspector/run", { mode: "project", part: "Whole site", prompt: "", request: "do anything", model: "claude-opus-5-5", effort: "low" }, { origin: "https://evil.example" }),
    await call("GET", "/__inspector/jobs", { headers: { "sec-fetch-site": "cross-site" } }),
    await call("GET", "/__inspector/events", { headers: { "sec-fetch-site": "cross-site" } }),
  ];
  for (const r of refused) {
    assert.equal(r.status, 403);
    assert.match(r.data.error, /refused this request/);
  }
  assert.equal(page(), readFileSync(join(SITE, "index.html"), "utf8"));
  assert.ok(!page().includes("#abcdef"));
  assert.equal(captures(), 0); // Claude was never started
});

test("a value that isn't a colour, or isn't closed, is not written (VEYL-P5)", async () => {
  const was = page();
  for (const [value, why] of [["notacolor", /Ink black wasn't saved: it isn't a colour/], ["#12345", /isn't a colour/], ["rgb(0,0", /isn't closed/], ["red</style>", /would end the value early/]]) {
    const site = await post("/__inspector/save", { tokens: { "--ink": value } });
    assert.equal(site.status, 400, value);
    assert.match(site.data.error, why);
    assert.match(site.data.error, /Nothing was written/);
    const layer = await post("/__inspector/save", { parts: { hero: { "--ink": value } } });
    assert.equal(layer.status, 400, value);
    assert.match(layer.data.error, /on Hero wasn't saved/);
  }
  // one bad value stops the whole save: the good one beside it isn't written either
  assert.equal((await post("/__inspector/save", { tokens: { "--gap": "32px", "--ink": "notacolor" } })).status, 400);
  assert.equal(page(), was);
});

test("good values are saved: site-wide, and for one layer", async () => {
  assert.equal((await post("/__inspector/save", { tokens: { "--ink": "rgb(20 20 30 / 0.9)", "--gap": "clamp(16px, 2vw, 32px)" } })).status, 200);
  assert.match(page(), /--ink: rgb\(20 20 30 \/ 0\.9\); --gap: clamp\(16px, 2vw, 32px\);/);
  assert.equal((await post("/__inspector/save", { parts: { hero: { "--ink": "#334455" } } })).status, 200);
  assert.match(page(), /\[data-dm="hero"\] \{\n  --ink: #334455;\n\}/);
});

test("a layer found by a selector saves under that selector, in one rule (MOOR-H1)", async () => {
  assert.doesNotMatch(page(), /data-dm="hero-title"/); // apply wrote no tag for it
  assert.equal((await post("/__inspector/save", { parts: { "hero-title": { "--ink": "#445566" } }, found: { "hero-title": 1 } })).status, 200);
  assert.match(page(), /\[data-dm="hero"\] h1 \{\n  --ink: #445566;\n\}/);
  assert.equal((await post("/__inspector/save", { parts: { "hero-title": { "--ink": "#556677" } } })).status, 200);
  assert.equal(page().match(/\[data-dm="hero"\] h1 \{/g).length, 1);
  assert.match(page(), /\[data-dm="hero"\] h1 \{\n  --ink: #556677;\n\}/);
  assert.match(page(), /\[data-dm="hero"\] \{\n  --ink: #334455;\n\}/); // Hero's own rule is another rule, untouched
});

test("a value for a layer with no element is refused, not written as a dead rule (UI-10)", async () => {
  const was = page();
  const none = await post("/__inspector/save", { parts: { spark: { "--ink": "#778899" } } });
  assert.equal(none.status, 400);
  assert.match(none.data.error, /Spark wasn't saved: nothing in the code is tagged data-dm="spark".*Nothing was written/);
  const gone = await post("/__inspector/save", { parts: { hero: { "--ink": "#778899" } }, found: { hero: 0 } });
  assert.equal(gone.status, 400);
  assert.match(gone.data.error, /Hero wasn't saved: it isn't on the page now/);
  assert.equal(page(), was);
});

const run = async (answer) => {
  writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify(answer));
  const started = await post("/__inspector/run", { mode: "part", part: "Hero", partId: "hero", prompt: "A hero.", request: "Make the greeting louder.", model: "claude-opus-5-5", effort: "low" });
  assert.equal(started.status, 200, started.text);
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const job = (await call("GET", "/__inspector/jobs")).data.jobs.find((j) => j.id === started.data.job.id);
    if (job.state === "done" || job.state === "error") return job;
  }
  throw new Error("the change never finished");
};
test("a change to a layer found by a selector tells Claude which element it is", async () => {
  writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify({ summary: "Nothing to do.", edits: [], create: [] }));
  const started = await post("/__inspector/run", { mode: "part", part: "Hero title", partId: "hero-title", prompt: "The headline.", request: "Make it bolder.", model: "claude-opus-5-5", effort: "low" });
  assert.equal(started.status, 200, started.text);
  for (let i = 0; i < 100 && !["done", "error"].includes((await call("GET", "/__inspector/jobs")).data.jobs.find((j) => j.id === started.data.job.id).state); i++) await sleep(100);
  const last = readdirSync(CAPTURE).filter((f) => f !== "answer.json").sort().at(-1);
  const sent = JSON.parse(readFileSync(join(CAPTURE, last), "utf8"));
  assert.match(sent.input, /On the page this part is the element matching `\[data-dm="hero"\] h1` \(inside Hero\)\. It has no data-dm tag of its own in the code: don't add one\./);
  assert.ok(sent.input.includes(`<section data-dm="hero" class="hero">`)); // its place in the code: the tagged part it sits in
});

const needs = (file) => ({ summary: "", edits: [], create: [], needs: { packages: [], files: [file], newFiles: [], why: "The greeting is set in that script." } });

test("a big file Claude asks for isn't sent whole: the person is asked (F1)", async () => {
  const sent = captures();
  const job = await run(needs("big.js"));
  assert.equal(captures(), sent + 1); // the first call only: no second call with the file
  assert.equal(job.state, "done");
  assert.deepEqual(job.needs.files, ["big.js"]);
  assert.match(job.needs.why, /The greeting is set in that script\. Sending this file whole makes the request about \d+k tokens, so the studio asks first/);
  assert.ok(job.log.some((l) => /big\.js \(~\d+k tokens\).*wasn't sent/.test(l)));
});

test("a small file Claude asks for is still sent at once", async () => {
  const sent = captures();
  const job = await run(needs("small.js"));
  assert.equal(captures(), sent + 2); // the first call, then the same request with small.js
  assert.ok(job.log.some((l) => /Claude asked for small\.js: sending it whole/.test(l)));
  const second = readdirSync(CAPTURE).filter((f) => f !== "answer.json").sort().at(-1);
  assert.ok(JSON.parse(readFileSync(join(CAPTURE, second), "utf8")).input.includes(`<file path="small.js">`));
});

// --- Before/After: an edit made outside the inspector while the "before" is showing

test("an outside edit made while the page shows a change's \"before\" is kept, not overwritten", async () => {
  const job = await run({ summary: "A warmer greeting.", edits: [{ file: "index.html", find: "<h1>Hello there</h1>", replace: "<h1>Hello again</h1>" }], create: [] });
  assert.equal(job.state, "done", job.error);
  const compare = (side) => post("/__inspector/compare", { thread: job.thread, side });
  const file = join(SITE, "index.html");
  const latestLog = async () => (await call("GET", "/__inspector/jobs")).data.jobs.find((j) => j.id === job.id).log.join(" | ");

  // 1. an edit on other lines: carried onto the "after"
  assert.equal((await compare("before")).status, 200);
  assert.match(page(), /<h1>Hello there<\/h1>/);
  writeFileSync(file, `${page()}<!-- my note, written in my editor -->\n`);
  assert.equal((await compare("after")).status, 200);
  assert.match(page(), /<h1>Hello again<\/h1>/); // the change is back
  assert.match(page(), /my note, written in my editor/); // and the edit wasn't lost
  assert.match(await latestLog(), /index\.html was edited outside the studio .* your edit was kept, on top of the change/);

  // 2. an edit on the very line the change touched: the file is left as the person has it
  assert.equal((await compare("before")).status, 200);
  writeFileSync(file, page().replace("<h1>Hello there</h1>", "<h1>Hello from me</h1>"));
  assert.equal((await compare("after")).status, 200);
  assert.match(page(), /<h1>Hello from me<\/h1>/);
  assert.match(await latestLog(), /on the lines this change touched: the file was left as you have it/);

  // 3. no outside edit: "after" is put back exactly, as before
  writeFileSync(file, page().replace("<h1>Hello from me</h1>", "<h1>Hello again</h1>"));
  await post("/__inspector/save", { tokens: { "--gap": "20px" } }); // records the outside edit, so the next compare starts clean
  const settled = page();
  assert.equal((await compare("before")).status, 200);
  assert.notEqual(page(), settled);
  assert.equal((await compare("after")).status, 200);
  assert.equal(page(), settled);
});

// --- step 3: the result is looked at

test("after a Claude change the CSS is checked too, and the panel's report of the page is kept on the card", async () => {
  const job = await run({ summary: "Roomier.", edits: [{ file: "index.html", find: "padding: var(--gap); }", replace: "padding: calc(var(--gap) * 2); }" }], create: [] });
  assert.equal(job.state, "done", job.error);
  assert.ok(job.log.some((l) => /Scripts parse, the CSS is whole/.test(l)), job.log.join(" | "));
  assert.equal((await post("/__inspector/observed", { job: job.id, width: 390, note: "Nothing on Hero looks different at 390 px." })).status, 200);
  const kept = (await call("GET", "/__inspector/jobs")).data.jobs.find((j) => j.id === job.id);
  assert.deepEqual([kept.observed.width, kept.observed.note], [390, "Nothing on Hero looks different at 390 px."]);
  assert.equal((await post("/__inspector/observed", { job: "nope", width: 390, note: "x" })).status, 400);
});

test("a change that leaves a rule open is caught and sent back to Claude once, not reported as done", async () => {
  const sent = captures();
  // the edit drops the rule's closing brace: every rule after it would be swallowed
  const job = await run({ summary: "Tighter.", edits: [{ file: "index.html", find: "padding: calc(var(--gap) * 2); }", replace: "padding: var(--gap);" }], create: [] });
  assert.ok(job.log.some((l) => /Check failed: one fix call with the errors/.test(l)), job.log.join(" | "));
  assert.equal(captures(), sent + 2); // the change, then one fix call
  const fix = JSON.parse(readFileSync(join(CAPTURE, readdirSync(CAPTURE).filter((f) => f !== "answer.json").sort().at(-1)), "utf8"));
  assert.match(fix.input, /index\.html: the CSS no longer closes what it opens/);
  assert.equal(job.state, "error"); // the stand-in has no second answer: the change is recorded as stopped, not as done
});

// --- edits the inspector writes itself: quiet when they work, and never a Claude request unasked

test("words typed over the page are written with no card, and can be taken back by their version", async () => {
  const jobsBefore = (await call("GET", "/__inspector/jobs")).data.jobs.length;
  const sent = captures();
  const h1 = page().match(/<h1>([^<]+)<\/h1>/)[1];
  const edit = await post("/__inspector/text", { partId: "hero", changes: [{ from: h1, to: "Good morning" }], whole: { from: h1, to: "Good morning" }, model: "claude-opus-5-5", effort: "low" });
  assert.equal(edit.status, 200, edit.text);
  assert.equal(edit.data.direct, true);
  assert.match(page(), /<h1>Good morning<\/h1>/);
  assert.equal((await call("GET", "/__inspector/jobs")).data.jobs.length, jobsBefore); // no card
  assert.equal(captures(), sent); // and nothing sent to Claude
  const history = (await call("GET", "/__inspector/history")).data.entries;
  assert.equal(history[0].id, edit.data.entry); // it is a version, the newest
  assert.equal(history[0].kind, "direct");
  const undo = await post("/__inspector/undo-edit", { entry: edit.data.entry });
  assert.equal(undo.status, 200, undo.text);
  assert.match(page(), new RegExp(`<h1>${h1}</h1>`));
  assert.equal((await post("/__inspector/undo-edit", { entry: edit.data.entry })).status, 400); // once only
});

test("an edit that can't be written directly sends nothing to Claude until the person asks", async () => {
  const jobsBefore = (await call("GET", "/__inspector/jobs")).data.jobs.length;
  const sent = captures();
  const was = page();
  const body = { partId: "hero", changes: [{ from: "Words no file has", to: "Other words" }], whole: { from: "Words no file has", to: "Other words" }, model: "claude-opus-5-5", effort: "low" };
  const tried = await post("/__inspector/text", body);
  assert.equal(tried.status, 200, tried.text);
  assert.equal(tried.data.direct, false);
  assert.ok(tried.data.why.length > 10);
  assert.ok(tried.data.tokens > 3000); // what asking Claude would cost, for the button
  assert.equal(tried.data.job, undefined);
  assert.equal(captures(), sent);
  assert.equal((await call("GET", "/__inspector/jobs")).data.jobs.length, jobsBefore);
  assert.equal(page(), was);
  // a slider the same way: a setting the map doesn't list can't be written, and isn't sent
  const param = await post("/__inspector/link", { partId: "hero", from: "#nowhere", to: "#somewhere", model: "claude-opus-5-5", effort: "low" });
  assert.equal(param.data.direct, false);
  assert.equal(captures(), sent);
  // asked: now it is a Claude change, with a card
  const asked = await post("/__inspector/text", { ...body, claude: true });
  assert.equal(asked.data.direct, false);
  assert.ok(asked.data.job?.id);
  for (let i = 0; i < 50 && captures() === sent; i++) await sleep(100);
  assert.equal(captures(), sent + 1);
});

// --- step 5: one history model. What is in the page is read from the newest version's list, for cards and History alike

const jobNow = async (id) => (await call("GET", "/__inspector/jobs")).data.jobs.find((j) => j.id === id);
const historyNow = async () => (await call("GET", "/__inspector/history")).data.entries; // newest first
const titleOf = () => page().match(/<title>([^<]*)<\/title>/)[1];
const h1Of = () => page().match(/<h1[^>]*>([^<]+)<\/h1>/)[1];
const change = (find, replace) => run({ summary: "Done.", edits: [{ file: "index.html", find, replace }], create: [] });
let shop; // a change to the title
let louder; // a later change, to the headline (other lines of the file)

test("Keep keeps the card, and a kept change can still be taken back on its own", async () => {
  shop = await change("<title>Tiny</title>", "<title>Tiny shop</title>");
  assert.equal(shop.state, "done", shop.error);
  assert.equal(shop.undone, false);
  assert.equal((await post("/__inspector/keep", { thread: shop.thread })).status, 200);
  assert.equal((await jobNow(shop.id))?.kept, true, "the card is gone or not marked kept");
  const h1 = h1Of();
  louder = await change(`<h1>${h1}</h1>`, `<h1>${h1}!</h1>`);
  assert.equal(louder.state, "done", louder.error);
  const undo = await post("/__inspector/undo", { thread: shop.thread });
  assert.equal(undo.status, 200, undo.text);
  assert.equal(titleOf(), "Tiny");
  assert.equal(h1Of(), `${h1}!`, "the change made after it is gone too");
  assert.deepEqual([(await jobNow(shop.id)).undone, (await jobNow(shop.id)).kept, (await jobNow(louder.id)).undone], [true, true, false]);
  const entry = (await historyNow()).find((e) => e.id === shop.entry);
  assert.equal(entry.undone, true, "History doesn't say the change is out of the page");
});

test("a change that was taken out can be brought back, keeping what was made since", async () => {
  const h1 = h1Of();
  const back = await post("/__inspector/bring-back", { thread: shop.thread });
  assert.equal(back.status, 200, back.text);
  assert.equal(titleOf(), "Tiny shop");
  assert.equal(h1Of(), h1);
  assert.equal((await jobNow(shop.id)).undone, false);
  const history = await historyNow();
  assert.equal(history[0].kind, "redo");
  assert.equal(history.find((e) => e.id === shop.entry).undone, false);
  assert.equal((await post("/__inspector/bring-back", { thread: shop.thread })).status, 400, "it is in the page already");
});

test("a change whose lines were rewritten since isn't brought back, and nothing is touched", async () => {
  assert.equal((await post("/__inspector/undo", { thread: shop.thread })).status, 200);
  const small = await change("<title>Tiny</title>", "<title>Small</title>");
  assert.equal(small.state, "done", small.error);
  const was = page();
  const back = await post("/__inspector/bring-back", { thread: shop.thread });
  assert.equal(back.status, 400);
  assert.match(back.data.error, /rewrote the same lines/);
  assert.equal(page(), was);
  assert.equal((await jobNow(shop.id)).undone, true);
  // and a change that still applies is brought back right after: the refusal left nothing half done
  assert.equal((await post("/__inspector/undo", { thread: small.thread })).status, 200);
  assert.equal((await post("/__inspector/bring-back", { thread: small.thread })).status, 200);
  assert.equal(titleOf(), "Small");
});

test("going back in History and forward again: cards and History say what that version holds", async () => {
  const before = await historyNow();
  const head = before[0].id;
  const at = before.findIndex((e) => e.id === louder.entry);
  const earlier = before[at + 1].id; // the version just before the headline change
  assert.equal((await jobNow(louder.id)).undone, false);
  assert.equal((await post("/__inspector/restore", { id: earlier })).status, 200);
  assert.equal((await jobNow(louder.id)).undone, true, "the card still says the change is in the page");
  assert.equal((await historyNow()).find((e) => e.id === louder.entry).undone, true);
  assert.equal((await post("/__inspector/restore", { id: head })).status, 200);
  assert.equal((await jobNow(louder.id)).undone, false, "going forward again, the card still says undone");
  assert.equal((await historyNow()).find((e) => e.id === louder.entry).undone, false);
  assert.match(h1Of(), /!$/);
});

test("History has points to go back to: the start, each save, before going back, and one every ten versions", async () => {
  const points = (await historyNow()).filter((e) => e.point).map((e) => e.point);
  assert.ok(points.includes("Starting point"), points.join(" | "));
  assert.ok(points.includes("Saved"), points.join(" | "));
  assert.ok(!points.includes("Where the session started"), "the first session started at the starting point, which is one already");
  assert.ok(points.some((p) => /^Before going back to v\d+$/.test(p)), points.join(" | "));
  // ten edits in a row with nothing else: the tenth is marked
  for (let i = 0; i < 11; i++) {
    const h1 = h1Of();
    const to = `Round ${i}`;
    const edit = await post("/__inspector/text", { partId: "hero", changes: [{ from: h1, to }], whole: { from: h1, to }, model: "claude-opus-5-5", effort: "low" });
    assert.equal(edit.data.direct, true, edit.text);
  }
  const last = (await historyNow()).slice(0, 11);
  assert.equal(last.filter((e) => /changes later$/.test(e.point ?? "")).length, 1, last.map((e) => `${e.id}:${e.point ?? "-"}`).join(" "));
  assert.ok(last.every((e) => e.contains === undefined), "the lists stay on the server");
});

test("after a restart, resolved cards are still listed, and the next change marks where the new session started", async () => {
  server.kill();
  await sleep(300);
  await startServer();
  assert.equal((await jobNow(shop.id))?.kept, true, "the kept card didn't survive the restart");
  const head = (await historyNow())[0];
  assert.equal(head.point, undefined);
  const h1 = h1Of();
  const edit = await post("/__inspector/text", { partId: "hero", changes: [{ from: h1, to: "A new day" }], whole: { from: h1, to: "A new day" }, model: "claude-opus-5-5", effort: "low" });
  assert.equal(edit.data.direct, true, edit.text);
  assert.equal((await historyNow()).find((e) => e.id === head.id).point, "Where the session started");
});

// --- step 6: an object picked inside a layer becomes a layer of the map, with no call to Claude

const mapNow = () => JSON.parse(readFileSync(join(SITE, "inspector.map.json"), "utf8"));
const picked = (id, more = {}) => ({ id, label: "Headline", kind: "text", anchor: "hero", listedIn: "hero", selector: "[data-dm='hero'] > h1:nth-of-type(1)", path: [{ tag: "h1", nth: 1, of: 1 }], tag: "h1", classes: "", words: h1Of(), ...more });

test("what isn't a picked object under a tagged layer is refused, and nothing is written", async () => {
  const was = [page(), JSON.stringify(mapNow())];
  for (const bad of [picked("hero-2"), picked("pick-a1", { anchor: "nope" }), picked("pick-a1", { anchor: "hero-title" }), picked("pick-a1", { selector: "[data-dm='spark'] > h1:nth-of-type(1)" }), picked("pick-a1", { selector: "h1 { color: red }" }), picked("pick-a1", { path: [] }), picked("pick-a1", { path: [{ tag: "h1", nth: 2, of: 1 }] })]) {
    const r = await post("/__inspector/layer", bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 90));
  }
  assert.deepEqual([page(), JSON.stringify(mapNow())], was);
});

test("an object whose words on the page aren't the words in the file is kept by its address, and said to be set by a script", async () => {
  const was = page();
  const r = await post("/__inspector/layer", picked("pick-s1", { words: "100,000 and counting" }));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.data.tagged, r.data.scripted], [false, true]);
  assert.match(r.data.why, /a script sets them/);
  assert.equal(page(), was, "the file was touched");
  const entry = mapNow().parts.find((p) => p.id === "pick-s1");
  assert.deepEqual(entry.targets, [{ selector: "[data-dm='hero'] > h1:nth-of-type(1)" }]);
  assert.deepEqual([entry.parent, entry.group, entry.picked], ["hero", "Page", true]);
});

test("an object found in the file for certain is tagged there, as a version in History, and is a layer like any other", async () => {
  const jobsBefore = (await call("GET", "/__inspector/jobs")).data.jobs.length;
  const sent = captures();
  const at = (await call("GET", "/__inspector/map")).data.at;
  const r = await post("/__inspector/layer", picked("pick-h1"));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.data.tagged, r.data.file], [true, "index.html"]);
  assert.match(page(), /<h1 data-dm="pick-h1">/);
  assert.equal(captures(), sent, "something was sent to Claude");
  assert.equal((await call("GET", "/__inspector/jobs")).data.jobs.length, jobsBefore, "it made a card");
  const map = (await call("GET", "/__inspector/map")).data;
  assert.ok(map.at > at, "the map isn't said to have changed");
  const entry = map.map.parts.find((p) => p.id === "pick-h1");
  assert.deepEqual([entry.label, entry.kind, entry.parent, entry.targets[0].file], ["Headline", "text", "hero", "index.html"]);
  const newest = (await historyNow())[0];
  assert.deepEqual([newest.kind, newest.label], ["direct", "Made a layer: Headline"]);
  // again: the same layer, nothing more written
  const again = await post("/__inspector/layer", picked("pick-h1"));
  assert.deepEqual([again.status, again.data.tagged], [200, true]);
  assert.equal(mapNow().parts.filter((p) => p.id === "pick-h1").length, 1);
  assert.equal((page().match(/data-dm="pick-h1"/g) ?? []).length, 1);
  // and a change to it runs like a change to any layer, sending its own element
  writeFileSync(join(CAPTURE, "answer.json"), JSON.stringify({ summary: "Bolder.", edits: [], create: [] }));
  const started = await post("/__inspector/run", { mode: "part", part: "Headline", partId: "pick-h1", prompt: "", request: "Make it bolder.", model: "claude-opus-5-5", effort: "low" });
  assert.equal(started.status, 200, started.text);
  await sleep(600);
  const request = readdirSync(CAPTURE).filter((f) => f !== "answer.json").map((f) => readFileSync(join(CAPTURE, f), "utf8")).pop();
  assert.match(request, /<h1 data-dm=\\?"pick-h1\\?">/);
});

test("a lock left behind by a server that was stopped mid-write doesn't block History for good", async () => {
  server.kill();
  await sleep(300);
  writeFileSync(join(SITE, ".inspector", "git", "index.lock"), "");
  await startServer();
  const h1 = h1Of();
  const edit = await post("/__inspector/text", { partId: "hero", changes: [{ from: h1, to: "Still writing" }], whole: { from: h1, to: "Still writing" }, model: "claude-opus-5-5", effort: "low" });
  assert.equal(edit.status, 200, edit.text);
  assert.equal(edit.data.direct, true, edit.text);
  assert.equal((await historyNow())[0].kind, "direct");
});

test("several elements of one kind are kept as one layer, by the address they share, with no file touched", async () => {
  const was = page();
  const r = await post("/__inspector/layer", { id: "pick-many1", label: "Scripts", kind: "image", anchor: "hero", listedIn: "hero", selector: "[data-dm='hero'] > h1", path: [], several: 3, tag: "h1", classes: "", words: "" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.tagged, false);
  assert.match(r.data.why, /3 elements of one kind/);
  assert.equal(page(), was);
  assert.deepEqual(mapNow().parts.find((p) => p.id === "pick-many1").targets, [{ selector: "[data-dm='hero'] > h1" }]);
  // without "several", an object with no place given is still refused
  assert.equal((await post("/__inspector/layer", { id: "pick-many2", label: "x", anchor: "hero", selector: "[data-dm='hero'] > h1", path: [], tag: "h1", classes: "", words: "" })).status, 400);
});
