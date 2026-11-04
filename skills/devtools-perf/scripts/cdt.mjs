#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { validateAction, goto } from "./lib/actions.mjs";
import { Cdp, browserPort, connectPage, evaluate, getJson, limits, parsePorts, probeNode } from "./lib/cdp.mjs";
import { launch } from "./lib/chrome.mjs";
import { heapSnapshot, measure } from "./lib/measure.mjs";
import { nextWithSourceMaps } from "./lib/next.mjs";

const USAGE = `cdt: drive Chrome and measure CPU and memory per action, in the browser and on Node servers

Setup:
  cdt launch [url] [--headless] [--port 9222]   start a dedicated Chrome (own profile, no background
                                                 throttling, no back/forward cache)
  cdt pages                                      list browser page targets
  cdt node-targets [--scan 9229-9239]            list Node inspectors (pid, argv) to pick for --node
  cdt close                                      close the browser on --port
  cdt next build|start [--dir app] [-- args]     Next.js with source maps forced on, built into <distDir>/cdt-profile;
                                                 your next.config and own build are not touched

Page helpers:
  cdt goto <url> | eval <js> | shot <file.png> | heap <file.heapsnapshot>

Measure:
  cdt measure [opts] <action...>                 measure one action
  cdt flow <steps.json> [opts]                   measure each step of a flow

Actions:
  click <css>                 real mouse click at the element centre (scrolls it into view first if off-screen)
  type <css> <text>           focus the element, insert text
  press <key>                 Enter, Escape, Tab, Backspace, Space, ArrowUp/Down/Left/Right, or one character
  eval <js>                   run JS in the page (promises awaited)
  goto <url>                  navigate and wait for load (or for a same-document navigation)
  request [METHOD] <url> [body]   HTTP request from the CLI (no browser needed)
  idle <ms>                   do nothing (catches timers, polling, rAF loops)
  run <shell cmd>             run an external driver (Playwright script, load tool) while measuring

steps.json: [{"label": "open menu", "action": ["click", "#menu"]}, ...]

Options:
  --port N            browser debugging port (default 9222, or $CDT_PORT)
  --target STR        page whose URL contains STR (default: first page)
  --no-browser        measure Node targets only, even if a browser is listening
  --node PORTS        also measure Node inspectors: "9229", "9229,9230" or "auto" (scans 9229-9239)
  --filter STR        keep only functions whose resolved source path contains STR in the app lists
                      (app total, app self, app allocations); library code stays excluded; top self is unfiltered
  --label STR         step name (measure only)
  --settle MS         wait after the action before sampling (default 500)
  --repeat N          run the action/flow N times and report the after-GC trend per iteration
  --throttle N        browser CPU throttling factor (e.g. 4)
  --no-profile        no CPU or allocation profilers: clean CPU numbers and long tasks, but no function
                      lists or allocated bytes
  --trace             also record a full browser DevTools trace (open in the Performance panel); it
                      samples JS too, so read pictures from it, not numbers
  --heap-snapshots    heap snapshot before and after each step, per target (slow on big heaps)
  --cdp-timeout MS    longest wait for a DevTools protocol reply (default 60000; 0 waits forever)
  --action-timeout MS longest wait for an action, e.g. a page load or a run command (default 300000; 0 waits forever)
  --out DIR           new or empty artifact directory (default <tmpdir>/cdt-runs/<timestamp>, printed at start)
  --json              print the full JSON results instead of the text summary
`;

const BOOL = new Set(["headless", "no-profile", "no-browser", "trace", "heap-snapshots", "json", "help"]);
const VALUE = new Set(["port", "target", "node", "filter", "label", "settle", "repeat", "throttle", "cdp-timeout", "action-timeout", "out", "dir", "scan"]);

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOL.has(key)) opts[key] = true;
      else if (!VALUE.has(key)) throw new Error(`unknown flag --${key}. See cdt --help.`);
      else if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`--${key} needs a value`);
      else opts[key] = argv[++i];
    } else pos.push(a);
  }
  return { opts, pos };
}

function timeoutFlag(opts, key) {
  if (opts[key] === undefined) return undefined;
  const ms = Number(opts[key]);
  if (!(ms >= 0)) throw new Error(`--${key} takes milliseconds (0 waits forever)`);
  return ms;
}

function readSteps(file) {
  const steps = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(steps) || !steps.length) throw new Error(`${file} must be a non-empty array of {label, action}`);
  return steps.map((s, i) => {
    const where = `${file} step ${i + 1}`;
    if (!s || typeof s !== "object") throw new Error(`${where}: expected {label, action}`);
    if (s.label !== undefined && typeof s.label !== "string") throw new Error(`${where}: label must be a string`);
    validateAction(s.action, where);
    return { label: s.label ?? `step ${i + 1}`, action: s.action };
  });
}

async function main() {
  if (typeof WebSocket !== "function") throw new Error(`needs Node 22 or later (global WebSocket); this is ${process.version}`);
  const [cmd, ...rest] = process.argv.slice(2);
  const { opts, pos } = parseArgs(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || opts.help) return void console.log(USAGE);
  limits.cdpMs = timeoutFlag(opts, "cdp-timeout") ?? limits.cdpMs;
  limits.actionMs = timeoutFlag(opts, "action-timeout") ?? limits.actionMs;

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
      const cdp = await Cdp.connect(v.webSocketDebuggerUrl, "browser");
      await cdp.send("Browser.close").catch(() => {});
      return;
    }
    case "measure": {
      if (!pos.length) throw new Error("measure needs an action, e.g. cdt measure click '#save'");
      validateAction(pos, "measure");
      return measure(opts, [{ label: opts.label ?? pos.join(" ").slice(0, 40), action: pos }]);
    }
    case "flow":
      if (!pos[0]) throw new Error("flow needs a steps.json file");
      return measure(opts, readSteps(pos[0]));
  }

  const page = await connectPage(opts);
  try {
    switch (cmd) {
      case "goto":
        await page.send("Page.enable");
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
