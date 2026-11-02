#!/usr/bin/env node
// cdt: per-action CPU and memory measurement for a browser page and Node
// servers (Next.js and friends) over the Chrome DevTools Protocol.
// Zero dependencies. Needs Node 22+ (global WebSocket and fetch).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const USAGE = `cdt: drive Chrome and measure CPU and memory per action, in the browser and on Node servers

Setup:
  cdt launch [url] [--headless] [--port 9222]   start a dedicated Chrome (own profile, no background throttling)
  cdt pages                                      list browser page targets
  cdt node-targets [--scan 9229-9239]            list Node inspectors (pid, argv) to pick for --node
  cdt close                                      close the launched browser
  cdt next build|start [--dir app] [-- args]     Next.js with source maps forced on, built into .next/cdt-profile;
                                                 next.config untouched, tsconfig.json/next-env.d.ts restored

Page helpers:
  cdt goto <url> | eval <js> | shot <file.png> | heap <file.heapsnapshot>

Measure:
  cdt measure [opts] <action...>                 measure one action
  cdt flow <steps.json> [opts]                   measure each step of a flow

Actions:
  click <css>                 real mouse click at the element centre
  type <css> <text>           focus the element, insert text
  press <key>                 Enter, Escape, Tab, Backspace, Space, ArrowUp/Down/Left/Right, or a character
  eval <js>                   run JS in the page (promises awaited)
  goto <url>                  navigate and wait for load
  request [METHOD] <url> [body]   HTTP request from the CLI (no browser needed)
  idle <ms>                   do nothing (catches timers, polling, rAF loops)
  run <shell cmd>             run an external driver (Playwright script, load tool) while measuring

steps.json: [{"label": "open menu", "action": ["click", "#menu"]}, ...]

Options:
  --port N          browser debugging port (default 9222, or $CDT_PORT)
  --target STR      page whose URL contains STR (default: first page)
  --no-browser      measure Node targets only, even if a browser is listening
  --node PORTS      also measure Node inspectors: "9229", "9229,9230" or "auto" (scans 9229-9239)
  --filter STR      restrict top-function lists to frames whose URL contains STR (e.g. "/app/" or "src/")
  --label STR       step name (measure only)
  --settle MS       wait after the action before sampling (default 500)
  --repeat N        run the action/flow N times and report retained-heap growth per iteration
  --throttle N      browser CPU throttling factor (e.g. 4)
  --no-profile      skip sampling CPU profiles (less overhead, no top functions)
  --trace           also record a browser DevTools trace (open in the Performance panel)
  --heap-snapshots  heap snapshot before and after each step, per target (slow on big heaps)
  --out DIR         artifact directory (default ./.cdt-runs/<timestamp>)
  --json            print the full JSON results instead of the text summary
`;

// ---------- args ----------

const BOOL = new Set(["headless", "no-profile", "no-browser", "trace", "heap-snapshots", "json", "help"]);

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOL.has(key)) opts[key] = true;
      else opts[key] = argv[++i];
    } else pos.push(a);
  }
  return { opts, pos };
}

// ---------- CDP ----------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`${method}: ${msg.error.message}`));
        else res(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }

  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => res(new Cdp(ws)), { once: true });
      ws.addEventListener("error", () => rej(new Error(`cannot connect to ${url}`)), { once: true });
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej, method });
      this.ws.send(JSON.stringify(msg));
    });
  }

  on(method, fn) {
    const l = (msg) => { if (msg.method === method) fn(msg.params, msg.sessionId); };
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }

  close() { this.ws.close(); }
}

// A Target is one JS heap we measure: the browser page (flat session on the
// browser socket, so SystemInfo works too) or a Node inspector.
function makeTarget(kind, name, cdp, sessionId) {
  return {
    kind,
    name,
    cdp,
    sessionId,
    send: (method, params) => cdp.send(method, params, sessionId),
    on: (method, fn) => cdp.on(method, (p, sid) => { if (sid === sessionId) fn(p); }),
    once(method) {
      return new Promise((res) => { const off = this.on(method, (p) => { off(); res(p); }); });
    },
  };
}

const browserPort = (opts) => Number(opts.port ?? process.env.CDT_PORT ?? 9222);

async function getJson(p, path) {
  const r = await fetch(`http://127.0.0.1:${p}${path}`, { signal: AbortSignal.timeout(2000) });
  return r.json();
}

async function connectPage(opts) {
  const p = browserPort(opts);
  const version = await getJson(p, "/json/version").catch(() => {
    throw new Error(`no Chrome on port ${p}. Run "cdt launch" or start Chrome with --remote-debugging-port=${p}.`);
  });
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  const info = opts.target ? pages.find((t) => t.url.includes(opts.target)) : pages[0];
  if (!info) throw new Error(opts.target ? `no page with URL containing "${opts.target}"` : "no page targets open");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: info.targetId, flatten: true });
  const t = makeTarget("page", "browser", cdp, sessionId);
  t.url = info.url;
  return t;
}

function parsePorts(spec) {
  if (spec === "auto") return range("9229-9239");
  return String(spec).split(",").flatMap((s) => (s.includes("-") ? range(s) : [Number(s)]));
}

function range(s) {
  const [a, b] = s.split("-").map(Number);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

async function probeNode(p) {
  const list = await getJson(p, "/json/list").catch(() => null);
  const entry = list?.find((t) => t.type === "node");
  if (!entry) return null;
  const cdp = await Cdp.connect(entry.webSocketDebuggerUrl);
  const t = makeTarget("node", `node:${p}`, cdp);
  const info = await evaluate(t, `({ pid: process.pid, argv: process.argv.slice(1).join(" ") })`).catch(() => ({}));
  t.port = p;
  t.pid = info.pid;
  t.argv = info.argv ?? entry.title;
  t.name = `node:${p} pid ${info.pid}`;
  return t;
}

async function connectNodes(opts) {
  if (!opts.node) return [];
  const ports = parsePorts(opts.node);
  const found = (await Promise.all(ports.map(probeNode))).filter(Boolean);
  if (!found.length) throw new Error(`no Node inspector on ${ports.join(", ")}. Start the server with --inspect (Next.js: "next dev --inspect").`);
  return found;
}

async function evaluate(t, expression) {
  const r = await t.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`${t.name} threw: ${d.exception?.description ?? d.text}`);
  }
  return r.result.value;
}

// ---------- actions ----------

const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
};

const PAGE_ACTIONS = new Set(["click", "type", "press", "eval", "goto"]);

async function elementCentre(page, css) {
  const box = await evaluate(page, `(() => {
    const el = document.querySelector(${JSON.stringify(css)});
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) throw new Error(`no element matches ${css}`);
  return box;
}

async function goto(page, url) {
  await page.send("Page.enable");
  const loaded = page.once("Page.loadEventFired");
  const r = await page.send("Page.navigate", { url });
  if (r.errorText) throw new Error(`navigate failed: ${r.errorText}`);
  await loaded;
}

async function request(args) {
  const method = /^[A-Z]+$/.test(args[0]) ? args.shift() : "GET";
  const [url, body] = args;
  const t0 = performance.now();
  const r = await fetch(url, { method, body, headers: body ? { "content-type": "application/json" } : undefined });
  const ttfb = performance.now() - t0;
  const buf = await r.arrayBuffer();
  return { method, url, status: r.status, ttfbMs: round(ttfb), totalMs: round(performance.now() - t0), bytes: buf.byteLength };
}

async function runAction(ctx, action) {
  const [kind, ...args] = action;
  const page = ctx.page;
  if (PAGE_ACTIONS.has(kind) && !page) throw new Error(`"${kind}" needs a browser page; none is attached`);
  switch (kind) {
    case "click": {
      const { x, y } = await elementCentre(page, args[0]);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      return;
    }
    case "type":
      await evaluate(page, `document.querySelector(${JSON.stringify(args[0])})?.focus()`);
      await page.send("Input.insertText", { text: args.slice(1).join(" ") });
      return;
    case "press": {
      const k = KEYS[args[0]] ?? { code: `Key${args[0].toUpperCase()}`, text: args[0] };
      const base = { key: k.key ?? args[0], code: k.code, windowsVirtualKeyCode: k.keyCode };
      await page.send("Input.dispatchKeyEvent", { ...base, type: k.text ? "keyDown" : "rawKeyDown", text: k.text });
      await page.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
      return;
    }
    case "eval":
      return evaluate(page, args.join(" "));
    case "goto":
      return goto(page, args[0]);
    case "request":
      return request([...args]);
    case "idle":
      await sleep(Number(args[0] ?? 1000));
      return;
    case "run":
      return runShell(args.join(" "));
    default:
      throw new Error(`unknown action "${kind}". See cdt --help.`);
  }
}

function runShell(cmd) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, { shell: true, stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`"${cmd}" exited ${code}`))));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- sampling ----------

async function samplePage(page) {
  const [{ metrics }, procs] = await Promise.all([
    page.send("Performance.getMetrics"),
    page.cdp.send("SystemInfo.getProcessInfo").catch(() => ({ processInfo: [] })),
  ]);
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const cpu = Object.fromEntries(procs.processInfo.map((p) => [p.id, { type: p.type, s: p.cpuTime }]));
  return { m, cpu, t: performance.now() };
}

const sampleNode = (t) => evaluate(t, `({ cpu: process.cpuUsage(), mem: process.memoryUsage() })`);

async function gc(t) {
  await t.send("HeapProfiler.collectGarbage");
  await t.send("HeapProfiler.collectGarbage");
}

async function settle(page, ms) {
  await sleep(ms);
  if (!page) return;
  // Two frames so rendering caused by the action lands inside the window.
  // Raced against a timeout because rAF stalls in hidden tabs.
  await evaluate(page, `Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    new Promise(r => setTimeout(r, 1000)),
  ])`).catch(() => {});
}

const OBSERVER = `(() => {
  const want = ["longtask", "long-animation-frame"].filter(t => PerformanceObserver.supportedEntryTypes.includes(t));
  window.__cdt = { longtask: [], "long-animation-frame": [] };
  window.__cdtObs?.disconnect();
  window.__cdtObs = new PerformanceObserver(l => {
    for (const e of l.getEntries()) window.__cdt[e.entryType]?.push(Math.round(e.entryType === "long-animation-frame" ? e.blockingDuration : e.duration));
  });
  for (const type of want) window.__cdtObs.observe({ type });
})()`;

const READ_OBSERVER = `(() => { const r = window.__cdt; window.__cdtObs?.disconnect(); return r; })()`;

function watchNetwork(page) {
  const reqs = new Map();
  const offs = [
    page.on("Network.requestWillBeSent", (p) => {
      if (p.request.url.startsWith("data:")) return;
      reqs.set(p.requestId, { method: p.request.method, url: p.request.url, type: p.type, start: p.timestamp });
    }),
    page.on("Network.responseReceived", (p) => { const r = reqs.get(p.requestId); if (r) r.status = p.response.status; }),
    page.on("Network.loadingFinished", (p) => {
      const r = reqs.get(p.requestId);
      if (r) { r.ms = round((p.timestamp - r.start) * 1000); r.bytes = p.encodedDataLength; }
    }),
  ];
  return () => {
    offs.forEach((off) => off());
    return [...reqs.values()].map(({ start, ...r }) => r);
  };
}

async function readStream(t, handle) {
  const parts = [];
  for (;;) {
    const r = await t.cdp.send("IO.read", { handle, size: 1 << 20 });
    parts.push(r.base64Encoded ? Buffer.from(r.data, "base64") : Buffer.from(r.data));
    if (r.eof) break;
  }
  await t.cdp.send("IO.close", { handle });
  return Buffer.concat(parts);
}

async function heapSnapshot(t, file) {
  await gc(t);
  const chunks = [];
  const off = t.on("HeapProfiler.addHeapSnapshotChunk", (p) => chunks.push(p.chunk));
  await t.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  off();
  writeFileSync(file, chunks.join(""));
  return file;
}

const TRACE_CATEGORIES = [
  "-*", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack", "v8.execute", "disabled-by-default-v8.cpu_profiler", "blink.user_timing",
  "loading", "latencyInfo", "gpu",
];

// ---------- profile summary ----------

// ---------- source maps ----------
// Profiles report generated positions. Bundled, minified server code (Next.js
// production) is unreadable without mapping back to the original source.

const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

function decodeMappings(str) {
  const lines = [];
  let src = 0, sLine = 0, sCol = 0, name = 0;
  for (const line of str.split(";")) {
    const segs = [];
    let col = 0;
    for (const seg of line.split(",")) {
      if (!seg) continue;
      const v = [];
      let shift = 0, value = 0;
      for (const ch of seg) {
        const d = B64[ch];
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else { v.push(value & 1 ? -(value >>> 1) : value >>> 1); shift = 0; value = 0; }
      }
      col += v[0];
      if (v.length >= 4) {
        src += v[1]; sLine += v[2]; sCol += v[3];
        if (v.length >= 5) name += v[4];
        segs.push([col, src, sLine, sCol, v.length >= 5 ? name : -1]);
      }
    }
    lines.push(segs);
  }
  return lines;
}

function lookupFlat(map, line, col) {
  map._lines ??= decodeMappings(map.mappings ?? "");
  const segs = map._lines[line];
  if (!segs?.length) return null;
  let lo = 0, hi = segs.length - 1, hit = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid][0] <= col) { hit = segs[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  hit ??= segs[0];
  const [, s, sl, , n] = hit;
  const text = map.sourcesContent?.[s]?.split("\n")[sl];
  return { source: map.sources[s], line: sl + 1, name: n >= 0 ? map.names[n] : null, text };
}

function lookup(map, line, col) {
  if (!map.sections) return lookupFlat(map, line, col);
  let section = null;
  for (const s of map.sections) {
    const o = s.offset;
    if (o.line < line || (o.line === line && o.column <= col)) section = s;
    else break;
  }
  if (!section?.map) return null;
  const o = section.offset;
  return lookupFlat(section.map, line - o.line, line === o.line ? col - o.column : col);
}

const mapCache = new Map();

async function readUrl(url) {
  if (url.startsWith("data:")) {
    const [meta, data] = url.split(",", 2);
    return meta.endsWith(";base64") ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data);
  }
  if (url.startsWith("file://")) {
    const path = fileURLToPath(url);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
  return r.ok ? r.text() : null;
}

// Follow the script's own sourceMappingURL comment (bundlers such as
// Turbopack name maps by content hash), falling back to <script>.map.
async function loadMap(url) {
  if (mapCache.has(url)) return mapCache.get(url);
  let map = null;
  try {
    const scriptUrl = url.startsWith("/") ? `file://${url}` : url;
    if (/^(file|https?):/.test(scriptUrl)) {
      const code = await readUrl(scriptUrl);
      const ref = code?.match(/\/\/[#@] sourceMappingURL=(\S+)\s*$/)?.[1];
      const mapUrl = ref ? new URL(ref, scriptUrl).href : `${scriptUrl.split("?")[0]}.map`;
      const text = await readUrl(mapUrl);
      if (text) map = JSON.parse(text);
    }
  } catch {}
  mapCache.set(url, map);
  return map;
}

const NAME_PATTERNS = [
  /function\*?\s+([\w$]+)/,
  /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function|\(|[\w$]+\s*=>)/,
  /([\w$]+)\s*[:=]\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/,
  /^\s*(?:async\s+|static\s+|get\s+|set\s+)*([\w$]+)\s*\([^)]*\)\s*{/,
];

function guessName(text) {
  if (!text) return null;
  for (const re of NAME_PATTERNS) {
    const m = text.match(re);
    if (m && !["if", "for", "while", "switch", "catch", "return"].includes(m[1])) return m[1];
  }
  return null;
}

// Place the original source on disk where possible and show it relative to the
// project (the dir above .next/, else cwd).
function resolveSource(generatedUrl, source) {
  const gen = generatedUrl.replace(/^file:\/\//, "");
  const root = gen.includes("/.next/") ? gen.slice(0, gen.indexOf("/.next/")) : process.cwd();
  let s = source.replace(/^turbopack:\/\/\/\[project\]\//, `${root}/`).replace(/^file:\/\//, "");
  if (/^webpack(-internal)?:\/\//.test(s)) return s.replace(/^webpack(-internal)?:\/\/\/?(\([^)]*\)\/)?(\.\/)?/, "");
  if (!/^[a-z]+:/.test(s) && !isAbsolute(s) && isAbsolute(gen)) s = resolve(dirname(gen), s);
  return isAbsolute(s) && s.startsWith(`${root}/`) ? relative(root, s) : s;
}

// ---------- profile summary ----------

const SKIP_FRAMES = new Set(["(idle)", "(root)"]);
const META_FRAMES = new Set(["(program)", "(garbage collector)"]);

const VENDOR = /node_modules|^(node:|internal\/|evalmachine|(turbopack:\/\/\/)?\[(turbopack|externals)\])/;

// Your code: the running file is not a dependency, and the original source
// (when a map resolves it) is not one either. Unmapped bundle chunks
// (/_next/, .next/) are unknown, so they stay out of the app lists.
function isApp(url, source, mapped) {
  if (!source || VENDOR.test(url) || VENDOR.test(source)) return false;
  return mapped || !/\/_next\/|\.next\//.test(url);
}

async function describeFrames(profile) {
  const out = new Map();
  for (const x of profile.nodes) {
    const f = x.callFrame;
    const map = f.url ? await loadMap(f.url) : null;
    const hit = map ? lookup(map, f.lineNumber, f.columnNumber) : null;
    let name = f.functionName || "(anonymous)";
    let where;
    let source;
    if (hit?.source) {
      source = resolveSource(f.url, hit.source);
      if (name === "(anonymous)" || name.length <= 2) name = hit.name ?? guessName(hit.text) ?? name;
      where = `${source}:${hit.line}`;
    } else if (f.url) {
      source = resolveSource(f.url, f.url.split("?")[0]);
      where = `${source.split("/").slice(-3).join("/")}:${f.lineNumber + 1}`;
    }
    out.set(x.id, { key: where ? `${name} ${where}` : name, source: source ?? "", app: isApp(f.url ?? "", source, !!hit?.source) });
  }
  return out;
}

// self: time with the function at the top of the stack.
// total: inclusive time, counted once per sample even under recursion.
// app: the same restricted to your own source (not node_modules or Node internals),
// so framework plumbing does not crowd out your functions.
async function functionTimes(profile, filter, n = 8) {
  const samples = profile.samples ?? [];
  if (!samples.length) return { self: [], appSelf: [], appTotal: [] };
  const usPerSample = (profile.endTime - profile.startTime) / samples.length;
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const frames = await describeFrames(profile);
  const skip = (id) => SKIP_FRAMES.has(nodes.get(id).callFrame.functionName);
  const app = (id) => {
    const fr = frames.get(id);
    return filter ? fr.source.includes(filter) : fr.app;
  };

  const self = new Map(), appSelf = new Map(), appTotal = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const leaf of samples) {
    if (skip(leaf)) continue;
    const k = frames.get(leaf).key;
    bump(self, k);
    // Attribute leaf time to the nearest app frame: time inside a library
    // called from your function counts as that function's self cost.
    let owner = leaf;
    while (owner !== undefined && !app(owner)) owner = parent.get(owner);
    if (owner !== undefined) bump(appSelf, frames.get(owner).key);
    const seen = new Set();
    for (let id = leaf; id !== undefined; id = parent.get(id)) {
      if (!app(id)) continue;
      const key = frames.get(id).key;
      if (!seen.has(key)) { seen.add(key); bump(appTotal, key); }
    }
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([fn, hits]) => ({ fn, ms: round((hits * usPerSample) / 1000) }));
  return { self: top(self), appSelf: top(appSelf), appTotal: top(appTotal) };
}

// ---------- measurement ----------

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const sec = (s) => round(s * 1000);

function pageDiff(a, b) {
  const d = (k) => (b.m[k] ?? 0) - (a.m[k] ?? 0);
  // Per process id, so a process started mid-step (site isolation on
  // navigation) counts from zero and one that exited does not go negative.
  const cpu = {};
  for (const [id, p] of Object.entries(b.cpu)) cpu[p.type] = (cpu[p.type] ?? 0) + p.s - (a.cpu[id]?.s ?? 0);
  for (const k of Object.keys(cpu)) cpu[k] = sec(cpu[k]);
  return {
    mainThread: { taskMs: sec(d("TaskDuration")), scriptMs: sec(d("ScriptDuration")), layoutMs: sec(d("LayoutDuration")), styleMs: sec(d("RecalcStyleDuration")), layouts: d("LayoutCount"), styleRecalcs: d("RecalcStyleCount") },
    processCpuMs: cpu,
    dom: { nodes: d("Nodes"), listeners: d("JSEventListeners"), documents: d("Documents"), frames: d("Frames") },
    heapBytes: d("JSHeapUsedSize"),
  };
}

// Brackets one step on every target: GC, start profilers, act, settle,
// sample, stop profilers, GC again to split "allocated" from "retained".
async function measureStep(ctx, step, cfg, tag) {
  const base = join(cfg.out, tag);
  const targets = [ctx.page, ...ctx.nodes].filter(Boolean);
  const artifacts = {};
  const art = (t, kind) => `${base}.${t.kind === "page" ? "browser" : `node-${t.port}`}.${kind}`;

  for (const t of targets) {
    if (cfg.heapSnapshots) artifacts[`${t.name} heapBefore`] = await heapSnapshot(t, art(t, "before.heapsnapshot"));
    await gc(t);
  }
  if (ctx.page) {
    await evaluate(ctx.page, OBSERVER).catch(() => {});
    if (cfg.trace) await ctx.page.send("Tracing.start", { traceConfig: { includedCategories: TRACE_CATEGORIES }, transferMode: "ReturnAsStream" });
  }
  const stopNetwork = ctx.page && watchNetwork(ctx.page);
  let navCount = 0;
  const offNav = ctx.page?.on("Page.frameNavigated", (p) => { if (!p.frame.parentId) navCount++; });
  const navigations = () => { offNav?.(); return navCount; };
  if (cfg.profile) for (const t of targets) await t.send("Profiler.start");

  const pageBefore = ctx.page && (await samplePage(ctx.page));
  const nodeBefore = await Promise.all(ctx.nodes.map(sampleNode));
  const t0 = performance.now();
  let error, actionResult;
  try {
    actionResult = await runAction(ctx, step.action);
  } catch (e) {
    error = e.message;
  }
  const actionMs = round(performance.now() - t0);
  await settle(ctx.page, cfg.settle);
  const pageAfter = ctx.page && (await samplePage(ctx.page));
  const nodeAfter = await Promise.all(ctx.nodes.map(sampleNode));
  const wallMs = round(performance.now() - t0);

  const profiles = new Map();
  if (cfg.profile) {
    for (const t of targets) {
      const { profile } = await t.send("Profiler.stop");
      artifacts[`${t.name} cpuprofile`] = art(t, "cpuprofile");
      writeFileSync(art(t, "cpuprofile"), JSON.stringify(profile));
      profiles.set(t, await functionTimes(profile, cfg.filter));
    }
  }
  if (ctx.page && cfg.trace) {
    const done = ctx.page.once("Tracing.tracingComplete");
    await ctx.page.send("Tracing.end");
    const { stream } = await done;
    artifacts.trace = art(ctx.page, "trace.json");
    writeFileSync(artifacts.trace, await readStream(ctx.page, stream));
  }
  const requests = stopNetwork ? stopNetwork() : [];
  const long = ctx.page && (await evaluate(ctx.page, READ_OBSERVER).catch(() => null));

  for (const t of targets) await gc(t);
  const pageAfterGc = ctx.page && (await samplePage(ctx.page));
  const nodeAfterGc = await Promise.all(ctx.nodes.map(sampleNode));
  if (cfg.heapSnapshots) for (const t of targets) artifacts[`${t.name} heapAfter`] = await heapSnapshot(t, art(t, "after.heapsnapshot"));

  const result = { label: step.label, action: step.action, ...(error && { error }), wallMs, actionMs };
  if (actionResult && step.action[0] === "request") result.request = actionResult;

  if (ctx.page) {
    // Chrome resets per-document counters on navigation, so the new
    // document's counters are already this step's cost.
    const navigated = navigations() > 0;
    const base = navigated ? { m: {}, cpu: pageBefore.cpu } : pageBefore;
    const during = pageDiff(base, pageAfter);
    const retained = pageDiff(base, pageAfterGc);
    result.browser = {
      navigated,
      mainThread: during.mainThread,
      processCpuMs: during.processCpuMs,
      heap: { grewBytes: during.heapBytes, retainedBytes: retained.heapBytes, totalAfterGcBytes: pageAfterGc.m.JSHeapUsedSize },
      dom: retained.dom,
      longTasksMs: long?.longtask ?? [],
      loafBlockingMs: long?.["long-animation-frame"] ?? [],
      requests,
      top: profiles.get(ctx.page) ?? NO_PROFILE,
    };
  }
  result.servers = ctx.nodes.map((t, i) => {
    const [b, a, g] = [nodeBefore[i], nodeAfter[i], nodeAfterGc[i]];
    return {
      name: t.name,
      argv: t.argv,
      cpuMs: { user: round((a.cpu.user - b.cpu.user) / 1000), system: round((a.cpu.system - b.cpu.system) / 1000) },
      heap: { grewBytes: a.mem.heapUsed - b.mem.heapUsed, retainedBytes: g.mem.heapUsed - b.mem.heapUsed, totalAfterGcBytes: g.mem.heapUsed },
      externalRetainedBytes: g.mem.external - b.mem.external,
      rssBytes: g.mem.rss,
      rssDeltaBytes: g.mem.rss - b.mem.rss,
      top: profiles.get(t) ?? NO_PROFILE,
    };
  });
  result.artifacts = artifacts;
  return result;
}

function leakVerdict(iterations) {
  const series = (pick) => {
    const vals = iterations.map((iter) => pick(iter.at(-1)));
    const steady = vals.slice(1); // iteration 1 warms caches and lazy init
    const per = steady.length > 1 ? Math.round((steady.at(-1) - steady[0]) / (steady.length - 1)) : null;
    return { afterGcBytes: vals, steadyGrowthBytesPerIteration: per };
  };
  const out = {};
  if (iterations[0][0].browser) {
    out.browser = series((r) => r.browser.heap.totalAfterGcBytes);
    out.browser.nodesPerIteration = iterations.map((iter) => iter.reduce((s, r) => s + r.browser.dom.nodes, 0));
    out.browser.listenersPerIteration = iterations.map((iter) => iter.reduce((s, r) => s + r.browser.dom.listeners, 0));
  }
  iterations[0][0].servers.forEach((s, i) => {
    out[s.name] = series((r) => r.servers[i].heap.totalAfterGcBytes);
  });
  return out;
}

async function measure(opts, steps) {
  const repeat = Number(opts.repeat ?? 1);
  const cfg = {
    settle: Number(opts.settle ?? 500),
    profile: !opts["no-profile"],
    trace: !!opts.trace,
    heapSnapshots: !!opts["heap-snapshots"],
    filter: opts.filter,
    out: resolve(opts.out ?? join(".cdt-runs", new Date().toISOString().replace(/[:.]/g, "-"))),
  };
  mkdirSync(cfg.out, { recursive: true });

  const nodes = await connectNodes(opts);
  const wantsPage = !opts["no-browser"] && (!nodes.length || opts.port || opts.target || steps.some((s) => PAGE_ACTIONS.has(s.action[0])));
  const page = wantsPage ? await connectPage(opts) : null;
  if (!page && !nodes.length) throw new Error("nothing to measure");
  const ctx = { page, nodes };

  try {
    for (const t of [page, ...nodes].filter(Boolean)) {
      await t.send("HeapProfiler.enable");
      if (cfg.profile) {
        await t.send("Profiler.enable");
        await t.send("Profiler.setSamplingInterval", { interval: t.kind === "page" ? 100 : 200 });
      }
    }
    if (page) {
      await page.send("Page.bringToFront").catch(() => {});
      await page.send("Page.enable");
      await page.send("Performance.enable");
      await page.send("Network.enable");
      if (opts.throttle) await page.send("Emulation.setCPUThrottlingRate", { rate: Number(opts.throttle) });
    }

    const iterations = [];
    for (let i = 0; i < repeat; i++) {
      const iter = [];
      for (const [j, step] of steps.entries()) {
        const tag = `${String(j + 1).padStart(2, "0")}-${slug(step.label)}${repeat > 1 ? `-r${i + 1}` : ""}`;
        const r = await measureStep(ctx, step, cfg, tag);
        if (repeat > 1) r.iteration = i + 1;
        iter.push(r);
        appendFileSync(join(cfg.out, "results.jsonl"), JSON.stringify(r) + "\n");
        if (!opts.json) printStep(r);
      }
      iterations.push(iter);
    }
    if (page && opts.throttle) await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });

    const out = {
      out: cfg.out,
      page: page?.url,
      servers: nodes.map((t) => ({ name: t.name, argv: t.argv })),
      throttle: Number(opts.throttle ?? 1),
      steps: iterations.flat(),
    };
    if (repeat > 1) out.leak = leakVerdict(iterations);
    writeFileSync(join(cfg.out, "summary.json"), JSON.stringify(out, null, 2));
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else {
      if (out.leak) printLeak(out.leak);
      console.log(`artifacts: ${cfg.out}`);
    }
  } finally {
    page?.cdp.close();
    nodes.forEach((t) => t.cdp.close());
  }
}

// ---------- output ----------

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";

function size(bytes, signed = true) {
  const sign = !signed ? "" : bytes < 0 ? "-" : "+";
  const a = Math.abs(bytes);
  return a >= 1 << 20 ? `${sign}${round(a / (1 << 20))}MB` : `${sign}${round(a / 1024)}KB`;
}

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const fns = (list) => list.slice(0, 5).map((f) => `${f.fn} ${f.ms}ms`).join("; ");
const NO_PROFILE = { self: [], appSelf: [], appTotal: [] };

function printTop(indent, top) {
  if (top.self.length) console.log(`${indent} top self: ${fns(top.self)}`);
  if (top.appTotal.length) console.log(`${indent} app total: ${fns(top.appTotal)}`);
  if (top.appSelf.length) console.log(`${indent} app self (incl. library calls): ${fns(top.appSelf)}`);
}

function printStep(r) {
  const it = r.iteration ? ` #${r.iteration}` : "";
  console.log(`[${r.label}${it}] wall ${r.wallMs}ms (action ${r.actionMs}ms)${r.error ? ` ERROR ${r.error}` : ""}`);
  if (r.request) console.log(`  request ${r.request.method} ${r.request.url} → ${r.request.status}, ttfb ${r.request.ttfbMs}ms, ${size(r.request.bytes, false)}`);
  const b = r.browser;
  if (b) {
    const mt = b.mainThread;
    const procs = Object.entries(b.processCpuMs).filter(([, v]) => v > 0.5).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    if (b.navigated) console.log("  navigated: browser heap, DOM and main-thread figures are the new document's totals");
    console.log(`  browser main thread ${mt.taskMs}ms: script ${mt.scriptMs}, layout ${mt.layoutMs} (${mt.layouts}x), style ${mt.styleMs} (${mt.styleRecalcs}x)${procs ? ` | process cpu ms: ${procs}` : ""}`);
    console.log(`  browser heap ${size(b.heap.grewBytes)} during, ${size(b.heap.retainedBytes)} retained after GC (total ${size(b.heap.totalAfterGcBytes, false)}) | dom nodes ${signed(b.dom.nodes)}, listeners ${signed(b.dom.listeners)}`);
    if (b.longTasksMs.length) console.log(`  long tasks ${b.longTasksMs.length} (max ${Math.max(...b.longTasksMs)}ms, total ${b.longTasksMs.reduce((x, y) => x + y, 0)}ms)`);
    if (b.requests.length) console.log(`  requests: ${b.requests.slice(0, 8).map((q) => `${q.method} ${shortUrl(q.url)} ${q.status ?? "?"} ${q.ms ?? "?"}ms`).join("; ")}${b.requests.length > 8 ? ` (+${b.requests.length - 8} more)` : ""}`);
    printTop("  browser", b.top);
  }
  for (const s of r.servers) {
    console.log(`  ${s.name} cpu ${round(s.cpuMs.user + s.cpuMs.system)}ms (user ${s.cpuMs.user}, sys ${s.cpuMs.system}) | heap ${size(s.heap.grewBytes)} during, ${size(s.heap.retainedBytes)} retained (total ${size(s.heap.totalAfterGcBytes, false)}) | external ${size(s.externalRetainedBytes)} | rss ${size(s.rssBytes, false)}`);
    printTop("   ", s.top);
  }
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return (x.pathname + x.search).slice(0, 60);
  } catch {
    return u.slice(0, 60);
  }
}

function printLeak(leak) {
  console.log("leak check (heap after GC at the end of each iteration; iteration 1 is warm-up):");
  for (const [name, l] of Object.entries(leak)) {
    const growth = l.steadyGrowthBytesPerIteration === null ? "" : `, steady growth ${size(l.steadyGrowthBytesPerIteration)}/iteration`;
    console.log(`  ${name}: ${l.afterGcBytes.map((x) => size(x, false)).join(" → ")}${growth}`);
    if (l.nodesPerIteration) console.log(`    dom nodes per iteration ${l.nodesPerIteration.map(signed).join(", ")} | listeners ${l.listenersPerIteration.map(signed).join(", ")}`);
  }
}

// ---------- other commands ----------

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found. Set CHROME_PATH.");
  return found;
}

async function launch(opts, url) {
  const p = browserPort(opts);
  const already = await getJson(p, "/json/version").catch(() => null);
  if (already) return void console.log(`Chrome already listening on ${p} (${already.Browser})`);
  const profile = join(process.env.TMPDIR ?? tmpdir(), `cdt-profile-${p}`);
  const args = [
    `--remote-debugging-port=${p}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    ...(opts.headless ? ["--headless=new"] : []),
    url ?? "about:blank",
  ];
  spawn(findChrome(), args, { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 100; i++) {
    const v = await getJson(p, "/json/version").catch(() => null);
    if (v) return void console.log(`Chrome ${v.Browser} on port ${p}, profile ${profile}`);
    await sleep(100);
  }
  throw new Error("Chrome did not open its debugging port within 10s (inside a sandbox? Chrome needs to run unsandboxed)");
}

// ---------- Next.js with injected source maps ----------

const NEXT_DIST = ".next/cdt-profile";
// Files `next build` may rewrite (tsconfig include, route types reference).
const NEXT_TOUCHED = ["tsconfig.json", "next-env.d.ts"];

function countFiles(dir, re) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true }).filter((f) => re.test(String(f))).length;
}

// Runs the project's own next with the hook preloaded, so builds and the
// server use source maps and a separate distDir while next.config, .next and
// the files in NEXT_TOUCHED end up byte-for-byte as they were.
async function nextWithSourceMaps(opts, pos) {
  const [sub, ...extra] = pos;
  if (!["build", "start"].includes(sub)) throw new Error('usage: cdt next build|start [--dir app] [-- next args]');
  const dir = resolve(opts.dir ?? ".");
  const bin = createRequire(join(dir, "package.json")).resolve("next/dist/bin/next");
  const hook = fileURLToPath(new URL("./next-sourcemaps-hook.cjs", import.meta.url));
  const saved = NEXT_TOUCHED.map((f) => join(dir, f)).filter(existsSync).map((f) => [f, readFileSync(f)]);
  const restore = () => { for (const [f, buf] of saved) if (!existsSync(f) || !readFileSync(f).equals(buf)) writeFileSync(f, buf); };

  const args = [bin, sub, ...(sub === "start" && !extra.includes("--inspect") ? ["--inspect"] : []), ...extra];
  const env = {
    ...process.env,
    CDT_NEXT_DIST_DIR: NEXT_DIST,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(hook)}`.trim(),
  };
  const child = spawn(process.execPath, args, { cwd: dir, env, stdio: "inherit" });
  const forward = (sig) => child.kill(sig);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const code = await new Promise((res) => child.on("exit", (c, sig) => res(c ?? (sig ? 1 : 0))));
  restore();
  if (sub === "build" && code === 0) {
    const out = join(dir, NEXT_DIST);
    const server = countFiles(join(out, "server"), /\.js\.map$/);
    const browser = countFiles(join(out, "static"), /\.js\.map$/);
    console.log(`cdt: profiling build in ${out}: ${server} server and ${browser} browser source maps; next.config untouched${saved.length ? `, ${saved.map(([f]) => relative(dir, f)).join(" and ")} restored` : ""}`);
    if (!server || !browser) console.log("cdt: some maps are missing; function names for that side will stay minified");
    console.log(`cdt: serve it with "cdt next start${opts.dir ? ` --dir ${opts.dir}` : ""}" (adds --inspect)`);
  }
  process.exitCode = code;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { opts, pos } = parseArgs(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || opts.help) return void console.log(USAGE);

  switch (cmd) {
    case "launch":
      return launch(opts, pos[0]);
    case "next":
      return nextWithSourceMaps(opts, pos);
    case "pages": {
      const list = await getJson(browserPort(opts), "/json/list");
      for (const t of list.filter((t) => t.type === "page")) console.log(`${t.id}  ${t.url}  ${t.title}`);
      return;
    }
    case "node-targets": {
      const found = (await Promise.all(parsePorts(opts.scan ?? "auto").map(probeNode))).filter(Boolean);
      if (!found.length) console.log("no Node inspectors found");
      for (const t of found) { console.log(`${t.port}  pid ${t.pid}  ${t.argv}`); t.cdp.close(); }
      return;
    }
    case "close": {
      const v = await getJson(browserPort(opts), "/json/version");
      const cdp = await Cdp.connect(v.webSocketDebuggerUrl);
      await cdp.send("Browser.close").catch(() => {});
      return;
    }
    case "measure":
      if (!pos.length) throw new Error("measure needs an action, e.g. cdt measure click '#save'");
      return measure(opts, [{ label: opts.label ?? pos.join(" ").slice(0, 40), action: pos }]);
    case "flow": {
      const steps = JSON.parse(readFileSync(pos[0], "utf8"));
      if (!Array.isArray(steps)) throw new Error("steps.json must be an array of {label, action}");
      return measure(opts, steps.map((s, i) => ({ label: s.label ?? `step ${i + 1}`, action: s.action })));
    }
  }

  const page = await connectPage(opts);
  try {
    switch (cmd) {
      case "goto":
        await goto(page, pos[0]);
        console.log(`loaded ${pos[0]}`);
        break;
      case "eval":
        console.log(JSON.stringify(await evaluate(page, pos.join(" ")), null, 2) ?? "undefined");
        break;
      case "shot": {
        const { data } = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(pos[0], Buffer.from(data, "base64"));
        console.log(pos[0]);
        break;
      }
      case "heap":
        await page.send("HeapProfiler.enable");
        console.log(await heapSnapshot(page, pos[0]));
        break;
      default:
        throw new Error(`unknown command "${cmd}". See cdt --help.`);
    }
  } finally {
    page.cdp.close();
  }
}

main().catch((e) => {
  console.error(`cdt: ${e.message}`);
  process.exit(1);
});
