// One measured step on every target (browser page and Node servers):
//
//   heap snapshots (opt) → prepare action → GC → start probes → sample
//   → act → settle → sample → stop probes (in parallel) → GC → sample
//   → heap snapshots (opt) → symbolicate and write artifacts
//
// Nothing that costs CPU or allocates on a target (fetching source maps
// from the server, writing files) runs before the last sample.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PAGE_ACTIONS, prepareAction } from "./actions.mjs";
import { TargetLost, connectNodes, connectPage, evaluate, limits } from "./cdp.mjs";
import { printLeak, printStep, slug } from "./output.mjs";
import { allocSummary, cpuSummary } from "./profile.mjs";
import { round, sec, sleep } from "./util.mjs";

const BINDING = "__cdtReport";

// Long-task and long-animation-frame observer. Installed in the current
// document and, through Page.addScriptToEvaluateOnNewDocument, in every new
// top-level document before its own scripts, so navigations stay observed.
// Entries go straight to the CLI through a CDP binding and survive the
// document that produced them.
const OBSERVER = `(() => {
  if (window !== window.top || window.__cdtObs || typeof ${BINDING} !== "function") return;
  const types = ["longtask", "long-animation-frame"].filter(t => PerformanceObserver.supportedEntryTypes?.includes(t));
  if (!types.includes("longtask")) return;
  const send = list => {
    if (!list.length) return;
    ${BINDING}(JSON.stringify({ entries: list.map(e => ({
      type: e.entryType,
      at: performance.timeOrigin + e.startTime,
      ms: Math.round(e.entryType === "long-animation-frame" ? e.blockingDuration : e.duration),
    })) }));
  };
  window.__cdtObs = new PerformanceObserver(l => send(l.getEntries()));
  for (const type of types) window.__cdtObs.observe({ type, buffered: true });
  window.__cdtFlush = () => send(window.__cdtObs.takeRecords());
  ${BINDING}(JSON.stringify({ install: true }));
})()`;

// Two frames so rendering caused by the action lands in the window. Raced
// against a timeout because rAF stalls in hidden tabs; the loser is
// cancelled so nothing lingers into the retained-memory sample.
const TWO_FRAMES = `new Promise(r => {
  let id;
  const t = setTimeout(() => { cancelAnimationFrame(id); r(); }, 1000);
  id = requestAnimationFrame(() => { id = requestAnimationFrame(() => { clearTimeout(t); r(); }); });
})`;

const TRACE_CATEGORIES = [
  "-*", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack", "v8.execute", "disabled-by-default-v8.cpu_profiler", "blink.user_timing",
  "loading", "latencyInfo", "gpu",
];

// ---------- probes ----------
// A probe records something between start() and stop(). Failures other
// than a lost target leave { error } instead of a value; a lost target
// ends the run.

function probe(start, stop) {
  let on = false, error = null, value = null;
  const guard = async (fn) => {
    try { return await fn(); } catch (e) { if (e instanceof TargetLost) throw e; error = e.message; }
  };
  return {
    start: () => guard(async () => { await start(); on = true; }),
    stop: () => (on ? guard(async () => { on = false; value = await stop(); }) : undefined),
    get result() { return error ? { error } : value; },
  };
}

const cpuProbe = (t) => probe(
  () => t.send("Profiler.start"),
  async () => (await t.send("Profiler.stop")).profile,
);

// Sampled every 16KB on average (DevTools uses 32KB), so small steps still
// get a usable estimate of bytes allocated, collected or not.
const allocProbe = (t) => probe(
  () => t.send("HeapProfiler.startSampling", { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }),
  async () => (await t.send("HeapProfiler.stopSampling")).profile,
);

function networkProbe(page) {
  const reqs = new Map();
  let offs = [];
  return probe(
    async () => {
      offs = [
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
    },
    async () => {
      offs.forEach((off) => off());
      return [...reqs.values()].map(({ start, ...r }) => r);
    },
  );
}

// Counts cross-document main-frame navigations and tracks whether the main
// frame is still loading, so settle can wait for a navigation to finish.
function navProbe(page) {
  let count = 0, loading = false, offs = [];
  const p = probe(
    async () => {
      offs = [
        page.on("Page.frameNavigated", (e) => { if (!e.frame.parentId) count++; }),
        page.on("Page.frameStartedLoading", (e) => { if (e.frameId === page.mainFrameId) loading = true; }),
        page.on("Page.frameStoppedLoading", (e) => { if (e.frameId === page.mainFrameId) loading = false; }),
      ];
    },
    async () => { offs.forEach((off) => off()); return count; },
  );
  p.count = () => count;
  p.untilLoaded = async (ms) => {
    if (!loading) return;
    const w = page.waitFor("Page.frameStoppedLoading", ms, (e) => e.frameId === page.mainFrameId);
    if (!loading) w.cancel();
    else await w.promise;
  };
  return p;
}

function longTaskProbe(page, nav) {
  let from = Infinity, startObserved = false, installs = 0, off;
  const entries = [];
  return probe(
    async () => {
      off = page.on("Runtime.bindingCalled", (p) => {
        if (p.name !== BINDING) return;
        const m = JSON.parse(p.payload);
        if (m.install) installs++;
        for (const e of m.entries ?? []) if (e.at >= from) entries.push(e);
      });
      const now = await evaluate(page, `(${OBSERVER}, window.__cdtObs ? performance.timeOrigin + performance.now() : null)`);
      startObserved = now !== null;
      if (startObserved) from = now;
    },
    async () => {
      await evaluate(page, "window.__cdtFlush?.()").catch((e) => { if (e instanceof TargetLost) throw e; });
      off();
      // Observed only if the starting document and every document the
      // step navigated to had the observer.
      const observed = startObserved && installs >= nav.count();
      const pick = (type) => entries.filter((e) => e.type === type && e.ms > 0).map((e) => e.ms);
      return observed
        ? { observed, longTasksMs: pick("longtask"), loafBlockingMs: pick("long-animation-frame") }
        : { observed, reason: startObserved ? "a navigated-to document had no observer" : "this browser has no longtask observer" };
    },
  );
}

const traceProbe = (page) => probe(
  () => page.send("Tracing.start", { traceConfig: { includedCategories: TRACE_CATEGORIES }, transferMode: "ReturnAsStream" }),
  async () => {
    const done = page.waitFor("Tracing.tracingComplete", limits.cdpMs);
    await page.send("Tracing.end");
    return (await done.promise).stream;
  },
);

// ---------- samples ----------

async function samplePage(page) {
  const [{ metrics }, procs] = await Promise.all([
    page.send("Performance.getMetrics"),
    page.cdp.send("SystemInfo.getProcessInfo").catch((e) => { if (e instanceof TargetLost) throw e; return { processInfo: [] }; }),
  ]);
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const cpu = Object.fromEntries(procs.processInfo.map((p) => [p.id, { type: p.type, s: p.cpuTime }]));
  return { m, cpu };
}

const sampleNode = (t) => evaluate(t, `({ cpu: process.cpuUsage(), mem: process.memoryUsage() })`);

const sampleAll = async (ctx) => {
  const [page, ...nodes] = await Promise.all([ctx.page && samplePage(ctx.page), ...ctx.nodes.map(sampleNode)]);
  return { page, nodes };
};

async function gc(t) {
  await t.send("HeapProfiler.collectGarbage");
  await t.send("HeapProfiler.collectGarbage");
}

export async function heapSnapshot(t, file) {
  await gc(t);
  const fd = openSync(file, "w");
  const off = t.on("HeapProfiler.addHeapSnapshotChunk", (p) => writeSync(fd, p.chunk));
  try {
    // No reply limit: snapshot time grows with the heap.
    await t.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false }, { timeoutMs: 0 });
  } finally {
    off();
    closeSync(fd);
  }
  return file;
}

async function writeStream(t, handle, file) {
  const fd = openSync(file, "w");
  try {
    for (;;) {
      const r = await t.send("IO.read", { handle, size: 1 << 20 });
      writeSync(fd, r.base64Encoded ? Buffer.from(r.data, "base64") : r.data);
      if (r.eof) break;
    }
  } finally {
    closeSync(fd);
    await t.send("IO.close", { handle }).catch(() => {});
  }
  return file;
}

// ---------- diffs ----------

const MAIN_THREAD = { taskMs: "TaskDuration", scriptMs: "ScriptDuration", layoutMs: "LayoutDuration", styleMs: "RecalcStyleDuration", layouts: "LayoutCount", styleRecalcs: "RecalcStyleCount" };
const DOM = { nodes: "Nodes", listeners: "JSEventListeners", documents: "Documents", frames: "Frames" };

function mainThread(a, b) {
  // A navigation into a new renderer starts these counters from zero; the
  // after values are then the new document's whole cost so far.
  const reset = Object.values(MAIN_THREAD).some((k) => (b.m[k] ?? 0) < (a.m[k] ?? 0));
  const out = {};
  for (const [name, k] of Object.entries(MAIN_THREAD)) {
    const v = (b.m[k] ?? 0) - (reset ? 0 : (a.m[k] ?? 0));
    out[name] = name.endsWith("Ms") ? sec(v) : v;
  }
  if (reset) out.countersReset = true;
  return out;
}

// Per process id, so a process started mid-step (site isolation on
// navigation) counts from zero and one that exited does not go negative.
function processCpu(a, b) {
  const cpu = {};
  for (const [id, p] of Object.entries(b.cpu)) cpu[p.type] = (cpu[p.type] ?? 0) + p.s - (a.cpu[id]?.s ?? 0);
  for (const k of Object.keys(cpu)) cpu[k] = sec(cpu[k]);
  return cpu;
}

const pick = (m, keys) => Object.fromEntries(Object.entries(keys).map(([name, k]) => [name, m[k] ?? 0]));

// ---------- step ----------

async function summarise(t, cpu, alloc, filter) {
  const out = {};
  if (cpu) out.cpu = cpu.result?.error ? cpu.result : cpu.result && (await cpuSummary(cpu.result, filter));
  if (alloc) out.alloc = alloc.result?.error ? alloc.result : alloc.result && (await allocSummary(alloc.result, filter));
  return out;
}

export async function measureStep(ctx, step, cfg, tag) {
  const { page, nodes } = ctx;
  const targets = [page, ...nodes].filter(Boolean);
  const result = { label: step.label, action: step.action };
  const artifacts = {};
  const art = (t, kind) => join(cfg.out, `${tag}.${t.kind === "page" ? "browser" : `node-${t.port}`}.${kind}`);

  if (cfg.heapSnapshots) for (const t of targets) artifacts[`${t.name} heapBefore`] = await heapSnapshot(t, art(t, "before.heapsnapshot"));

  let act;
  try {
    act = await prepareAction(ctx, step.action);
  } catch (e) {
    if (e instanceof TargetLost) throw e;
    return { ...result, error: `could not prepare the action: ${e.message}` };
  }

  await Promise.all(targets.map(gc));

  const cpu = new Map(cfg.profile ? targets.map((t) => [t, cpuProbe(t)]) : []);
  const alloc = new Map(cfg.profile ? targets.map((t) => [t, allocProbe(t)]) : []);
  const nav = page && navProbe(page);
  const pageProbes = page ? { nav, network: networkProbe(page), longTasks: longTaskProbe(page, nav), trace: cfg.trace && traceProbe(page) } : {};
  const all = [...cpu.values(), ...alloc.values(), ...Object.values(pageProbes)].filter(Boolean);

  let before, after, afterGc;
  try {
    await Promise.all(all.map((p) => p.start()));
    before = await sampleAll(ctx);
    const t0 = performance.now();
    try {
      const r = await act();
      if (step.action[0] === "request") result.request = r;
      if (step.action[0] === "eval") result.value = r;
    } catch (e) {
      if (e instanceof TargetLost) throw e;
      result.error = e.message;
    }
    result.actionMs = round(performance.now() - t0);
    await sleep(cfg.settle);
    if (page) {
      await nav.untilLoaded(limits.actionMs).catch((e) => { result.error ??= `navigation did not finish: ${e.message}`; });
      await evaluate(page, TWO_FRAMES).catch((e) => { if (e instanceof TargetLost) throw e; });
    }
    after = await sampleAll(ctx);
    result.wallMs = round(performance.now() - t0);
  } catch (e) {
    await Promise.allSettled(all.map((p) => p.stop()));
    if (e instanceof TargetLost) throw e;
    return { ...result, error: `measurement failed: ${e.message}` };
  }
  await Promise.all(all.map((p) => p.stop()));
  await Promise.all(targets.map(gc));
  afterGc = await sampleAll(ctx);
  if (cfg.heapSnapshots) for (const t of targets) artifacts[`${t.name} heapAfter`] = await heapSnapshot(t, art(t, "after.heapsnapshot"));

  // Measurement is over; from here on, work on the targets cannot skew it.
  for (const t of targets) {
    const c = cpu.get(t)?.result, a = alloc.get(t)?.result;
    if (c && !c.error) writeFileSync((artifacts[`${t.name} cpuprofile`] = art(t, "cpuprofile")), JSON.stringify(c));
    if (a && !a.error) writeFileSync((artifacts[`${t.name} heapprofile`] = art(t, "heapprofile")), JSON.stringify(a));
  }
  const trace = pageProbes.trace?.result;
  if (trace?.error) artifacts.traceError = trace.error;
  else if (trace) artifacts.trace = await writeStream(page, trace, art(page, "trace.json"));

  if (page) {
    const [b, a, g] = [before.page, after.page, afterGc.page];
    const navigated = nav.result > 0;
    const prof = await summarise(page, cpu.get(page), alloc.get(page), cfg.filter);
    result.browser = {
      navigated,
      mainThread: mainThread(b, a),
      processCpuMs: processCpu(b, a),
      heap: {
        allocatedBytes: prof.alloc && !prof.alloc.error ? prof.alloc.allocatedBytes : null,
        // After a navigation the before sample held the old document, so
        // a difference is not this step's retention; report totals only.
        retainedBytes: navigated ? null : g.m.JSHeapUsedSize - b.m.JSHeapUsedSize,
        totalAfterGcBytes: g.m.JSHeapUsedSize,
      },
      dom: navigated ? null : Object.fromEntries(Object.entries(DOM).map(([name, k]) => [name, (g.m[k] ?? 0) - (b.m[k] ?? 0)])),
      domTotalAfterGc: pick(g.m, DOM),
      longTasks: pageProbes.longTasks.result,
      requests: pageProbes.network.result ?? [],
      profile: cfg.profile ? prof : null,
    };
  }
  result.servers = await Promise.all(nodes.map(async (t, i) => {
    const [b, a, g] = [before.nodes[i], after.nodes[i], afterGc.nodes[i]];
    const prof = await summarise(t, cpu.get(t), alloc.get(t), cfg.filter);
    return {
      name: t.name,
      argv: t.argv,
      cpuMs: { user: round((a.cpu.user - b.cpu.user) / 1000), system: round((a.cpu.system - b.cpu.system) / 1000) },
      heap: {
        allocatedBytes: prof.alloc && !prof.alloc.error ? prof.alloc.allocatedBytes : null,
        retainedBytes: g.mem.heapUsed - b.mem.heapUsed,
        totalAfterGcBytes: g.mem.heapUsed,
      },
      externalRetainedBytes: g.mem.external - b.mem.external,
      rssBytes: g.mem.rss,
      rssDeltaBytes: g.mem.rss - b.mem.rss,
      profile: cfg.profile ? prof : null,
    };
  }));
  result.artifacts = artifacts;
  return result;
}

// ---------- leak verdict ----------

// Least-squares slope of ys against 0..n-1.
function slope(ys) {
  const n = ys.length;
  const mx = (n - 1) / 2, my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return num / den;
}

// Totals after GC at the end of each iteration. Iteration 1 warms caches
// and lazy init, so the trend uses iterations 2 and later. Totals rather
// than per-step deltas keep navigations from reading as leaks.
function series(vals) {
  const steady = vals.slice(1);
  const out = { afterGc: vals, steadyGrowthPerIteration: steady.length >= 2 ? Math.round(slope(steady)) : null };
  if (steady.length < 3) out.note = "fewer than 3 iterations after warm-up; use --repeat 4 or more for a trend";
  return out;
}

export function leakVerdict(iterations) {
  const last = iterations.map((iter) => iter.at(-1));
  if (last.some((r) => r.error && !r.servers)) return { error: "an iteration's last step failed, so there is no end-of-iteration total" };
  const out = {};
  if (last[0].browser) {
    out.browser = {
      heapBytes: series(last.map((r) => r.browser.heap.totalAfterGcBytes)),
      domNodes: series(last.map((r) => r.browser.domTotalAfterGc.nodes)),
      listeners: series(last.map((r) => r.browser.domTotalAfterGc.listeners)),
    };
  }
  last[0].servers.forEach((s, i) => {
    out[s.name] = { heapBytes: series(last.map((r) => r.servers[i].heap.totalAfterGcBytes)) };
  });
  return out;
}

// ---------- run ----------

function prepareOut(dir) {
  const out = resolve(dir ?? join(tmpdir(), "cdt-runs", new Date().toISOString().replace(/[:.]/g, "-")));
  if (existsSync(out) && readdirSync(out).length) throw new Error(`--out ${out} already has files; pass a new or empty directory`);
  mkdirSync(out, { recursive: true });
  return out;
}

async function setupPage(page, cfg) {
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Performance.enable");
  await page.send("Network.enable");
  await page.send("Page.bringToFront").catch(() => {});
  page.mainFrameId = (await page.send("Page.getFrameTree")).frameTree.frame.id;
  await page.send("Runtime.addBinding", { name: BINDING });
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER });
  if (cfg.throttle) await page.send("Emulation.setCPUThrottlingRate", { rate: cfg.throttle });
  return async () => {
    if (cfg.throttle) await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    await evaluate(page, "window.__cdtObs?.disconnect(); delete window.__cdtObs; delete window.__cdtFlush;");
    await page.send("Runtime.removeBinding", { name: BINDING });
  };
}

export async function measure(opts, steps) {
  const repeat = Number(opts.repeat ?? 1);
  if (!(repeat >= 1)) throw new Error("--repeat takes a number of iterations, 1 or more");
  const cfg = {
    settle: Number(opts.settle ?? 500),
    profile: !opts["no-profile"],
    trace: !!opts.trace,
    heapSnapshots: !!opts["heap-snapshots"],
    filter: opts.filter,
    throttle: opts.throttle ? Number(opts.throttle) : null,
  };

  const nodes = await connectNodes(opts);
  const wantsPage = !opts["no-browser"] && (!nodes.length || opts.port || opts.target || steps.some((s) => PAGE_ACTIONS.has(s.action[0])));
  const page = wantsPage ? await connectPage(opts) : null;
  if (!page && !nodes.length) throw new Error("nothing to measure");
  const ctx = { page, nodes };
  cfg.out = prepareOut(opts.out);
  const log = opts.json ? (...a) => console.error(...a) : (...a) => console.log(...a);
  log(`cdt: results in ${cfg.out}`);
  if (cfg.profile) log("cdt: CPU and allocation profilers are on, so CPU figures include their overhead; rerun with --no-profile for clean CPU numbers");

  let teardown;
  let current;
  try {
    for (const t of [page, ...nodes].filter(Boolean)) {
      await t.send("HeapProfiler.enable");
      if (cfg.profile) {
        await t.send("Profiler.enable");
        await t.send("Profiler.setSamplingInterval", { interval: t.kind === "page" ? 100 : 200 });
      }
    }
    if (page) teardown = await setupPage(page, cfg);

    const iterations = [];
    for (let i = 0; i < repeat; i++) {
      const iter = [];
      for (const [j, step] of steps.entries()) {
        current = `${step.label}${repeat > 1 ? ` #${i + 1}` : ""}`;
        const tag = `${String(j + 1).padStart(2, "0")}-${slug(step.label)}${repeat > 1 ? `-r${i + 1}` : ""}`;
        const r = await measureStep(ctx, step, cfg, tag);
        if (repeat > 1) r.iteration = i + 1;
        iter.push(r);
        appendFileSync(join(cfg.out, "results.jsonl"), JSON.stringify(r) + "\n");
        if (!opts.json) printStep(r, cfg);
      }
      iterations.push(iter);
    }

    const out = {
      out: cfg.out,
      page: page?.url,
      servers: nodes.map((t) => ({ name: t.name, argv: t.argv })),
      throttle: cfg.throttle ?? 1,
      profilersOn: cfg.profile,
      steps: iterations.flat(),
    };
    if (repeat > 1) out.leak = leakVerdict(iterations);
    writeFileSync(join(cfg.out, "summary.json"), JSON.stringify(out, null, 2));
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else if (out.leak) printLeak(out.leak);
    if (out.steps.some((s) => s.error)) process.exitCode = 1;
  } catch (e) {
    if (e instanceof TargetLost) {
      throw new Error(`lost a target during step "${current}": ${e.message}. Steps finished before it are in ${join(cfg.out, "results.jsonl")}`);
    }
    throw e;
  } finally {
    await teardown?.().catch(() => {});
    page?.cdp.close();
    nodes.forEach((t) => t.cdp.close());
  }
}
