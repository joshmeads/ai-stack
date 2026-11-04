import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PAGE_ACTIONS, TWO_FRAMES, prepareAction } from "./actions.mjs";
import { NoReply, TargetLost, connectNodes, connectPage, evaluate, limits } from "./cdp.mjs";
import { printLeak, printStep, slug } from "./output.mjs";
import { allocSummary, cpuSummary } from "./profile.mjs";
import { ActionTimeout, RunAborted, round, sec, sleep } from "./util.mjs";

const LONG_TASK_CATEGORIES = ["-*", "disabled-by-default-devtools.timeline"];
const TRACE_CATEGORIES = [
  "-*", "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack", "v8.execute", "disabled-by-default-v8.cpu_profiler", "blink.user_timing",
  "loading", "latencyInfo", "gpu",
];
const LONG_TASK_US = 50_000;

function probe(start, stop, dispose = () => {}) {
  let on = false, error = null, value = null;
  const guard = async (fn) => {
    try { return await fn(); } catch (e) { if (e instanceof TargetLost) throw e; error = e.message; }
  };
  return {
    start: () => guard(async () => {
      try { await start(); on = true; } catch (e) { dispose(); throw e; }
    }),
    stop: () => (on ? guard(async () => {
      on = false;
      try { value = await stop(); } finally { dispose(); }
    }) : undefined),
    get result() { return error ? { error } : value; },
  };
}

const cpuProbe = (t) => probe(
  () => t.send("Profiler.start"),
  async () => (await t.send("Profiler.stop")).profile,
);

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
    async () => [...reqs.values()].map(({ start, ...r }) => r),
    () => offs.forEach((off) => off()),
  );
}

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
    async () => count,
    () => offs.forEach((off) => off()),
  );
  p.untilLoaded = async (ms) => {
    if (!loading) return;
    const w = page.waitFor("Page.frameStoppedLoading", ms, (e) => e.frameId === page.mainFrameId);
    if (!loading) w.cancel();
    else await w.promise;
  };
  return p;
}

function traceProbe(page, file) {
  const threads = new Map(), pids = new Set(), pending = new Set(), tasks = [];
  let off = null, fd, sep = "", on = false, done = null, error = null, dataLoss = false;
  const see = (e) => {
    const d = e.args?.data;
    if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
    else if (e.name === "TracingStartedInBrowser") (d?.frames ?? []).forEach((f) => f.processId && pids.add(f.processId));
    else if (e.name === "FrameCommittedInBrowser") { if (d?.processId) pids.add(d.processId); else if (d?.processPseudoId) pending.add(d.processPseudoId); }
    else if (e.name === "ProcessReadyInBrowser") { if (pending.has(d?.processPseudoId)) pids.add(d.processId); }
    else if (e.ph === "X" && e.name === "RunTask" && e.dur >= LONG_TASK_US) tasks.push(e);
  };
  const dispose = () => {
    off?.();
    off = null;
    if (fd !== undefined) { writeSync(fd, "\n]}\n"); closeSync(fd); fd = undefined; }
  };
  const fail = (e) => { if (e instanceof TargetLost) throw e; error = e.message; };
  return {
    async start() {
      try {
        if (file) { fd = openSync(file, "w"); writeSync(fd, '{"traceEvents":[\n'); }
        off = page.on("Tracing.dataCollected", ({ value }) => {
          for (const e of value) see(e);
          if (fd !== undefined) { writeSync(fd, sep + value.map((e) => JSON.stringify(e)).join(",\n")); if (value.length) sep = ",\n"; }
        });
        await page.send("Tracing.start", { traceConfig: { includedCategories: file ? TRACE_CATEGORIES : LONG_TASK_CATEGORIES }, transferMode: "ReportEvents" });
        on = true;
      } catch (e) {
        dispose();
        fail(e);
      }
    },
    async end() {
      if (!on) return;
      on = false;
      done = page.waitFor("Tracing.tracingComplete", limits.cdpMs, undefined, "--cdp-timeout");
      try {
        await page.send("Tracing.end");
      } catch (e) {
        done.cancel();
        done = null;
        dispose();
        fail(e);
      }
    },
    async drain() {
      if (!done) return;
      try {
        dataLoss = !!(await done.promise).dataLossOccurred;
      } catch (e) {
        fail(e);
      } finally {
        done = null;
        dispose();
      }
    },
    result(untilUs = Infinity) {
      if (error) return { error };
      if (!pids.size) return { observed: false, reason: "the trace did not say which renderer hosts this page" };
      const main = tasks.filter((e) => pids.has(e.pid) && threads.get(`${e.pid}:${e.tid}`) === "CrRendererMain" && e.ts < untilUs);
      return { observed: true, dataLoss, longTasksMs: main.map((e) => Math.round(e.dur / 1000)) };
    },
    get pagePids() { return error || !pids.size ? null : pids; },
    get error() { return error; },
  };
}

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
    await t.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false }, { timeoutMs: 0 });
  } finally {
    off();
    closeSync(fd);
  }
  return file;
}

const MAIN_THREAD = { taskMs: "TaskDuration", scriptMs: "ScriptDuration", layoutMs: "LayoutDuration", styleMs: "RecalcStyleDuration", layouts: "LayoutCount", styleRecalcs: "RecalcStyleCount" };
const DOM = { nodes: "Nodes", listeners: "JSEventListeners", documents: "Documents", frames: "Frames" };

function mainThread(before, after) {
  const reset = after.m.NavigationStart !== before.m.NavigationStart
    || Object.values(MAIN_THREAD).some((k) => (after.m[k] ?? 0) < (before.m[k] ?? 0));
  const out = {};
  for (const [name, k] of Object.entries(MAIN_THREAD)) {
    const v = (after.m[k] ?? 0) - (reset ? 0 : (before.m[k] ?? 0));
    out[name] = name.endsWith("Ms") ? sec(v) : v;
  }
  if (reset) out.countersReset = true;
  return out;
}

function processCpu(before, after, pagePids) {
  const ms = {};
  for (const [id, p] of Object.entries(after.cpu)) {
    const type = p.type === "renderer" && pagePids && !pagePids.has(Number(id)) ? "other renderers" : p.type;
    ms[type] = (ms[type] ?? 0) + p.s - (before.cpu[id]?.s ?? 0);
  }
  for (const k of Object.keys(ms)) ms[k] = sec(ms[k]);
  const exited = Object.entries(before.cpu)
    .filter(([id]) => !(id in after.cpu))
    .map(([id, p]) => ({ pid: Number(id), type: p.type, ...(pagePids?.has(Number(id)) ? { thisPage: true } : {}) }));
  for (const pid of pagePids ?? []) {
    if (!(pid in before.cpu) && !(pid in after.cpu)) exited.push({ pid, type: "renderer", thisPage: true, startedMidStep: true });
  }
  return { ms, renderers: pagePids ? "this page" : "all", exited };
}

const pick = (m, keys) => Object.fromEntries(Object.entries(keys).map(([name, k]) => [name, m[k] ?? 0]));

function partialProfile(profile, windowMs) {
  if (!profile || profile.error) return null;
  const spanMs = (profile.endTime - profile.startTime) / 1000;
  return spanMs < windowMs - Math.max(20, windowMs * 0.02) ? { coveredMs: round(spanMs), windowMs: round(windowMs) } : null;
}

async function summarise(cpu, alloc, filter, windowMs) {
  const out = {};
  if (cpu) out.cpu = cpu.result?.error ? cpu.result : cpu.result && (await cpuSummary(cpu.result, filter));
  if (alloc) out.alloc = alloc.result?.error ? alloc.result : alloc.result && (await allocSummary(alloc.result, filter));
  const partial = partialProfile(cpu?.result, windowMs);
  if (partial) out.partial = partial;
  return out;
}

const allocated = (prof) => (prof?.alloc && !prof.alloc.error ? prof.alloc.allocatedBytes : null);

function checkStopped(e, label) {
  if ((e instanceof ActionTimeout && !e.stopped) || e instanceof NoReply) {
    throw new RunAborted(`step "${label}": ${e.message}. It may still be running and would be counted in later steps, so the run stops here`);
  }
}

export async function measureStep(ctx, step, cfg, tag) {
  const { page, nodes } = ctx;
  const targets = [page, ...nodes].filter(Boolean);
  const artifacts = {};
  const result = { label: step.label, action: step.action, complete: false, artifacts };
  const art = (t, kind) => join(cfg.out, `${tag}.${t.kind === "page" ? "browser" : `node-${t.port}`}.${kind}`);

  let act;
  try {
    if (cfg.heapSnapshots) for (const t of targets) artifacts[`${t.name} heapBefore`] = await heapSnapshot(t, art(t, "before.heapsnapshot"));
  } catch (e) {
    if (e instanceof TargetLost) throw e;
    return { ...result, error: `heap snapshot before the step failed: ${e.message}` };
  }
  try {
    act = await prepareAction(ctx, step.action);
  } catch (e) {
    if (e instanceof TargetLost) throw e;
    return { ...result, error: `could not prepare the action: ${e.message}` };
  }

  const cpu = new Map(cfg.profile ? targets.map((t) => [t, cpuProbe(t)]) : []);
  const alloc = new Map(cfg.profile ? targets.map((t) => [t, allocProbe(t)]) : []);
  const nav = page && navProbe(page);
  const network = page && networkProbe(page);
  const traceFile = cfg.trace && page && art(page, "trace.json");
  const trace = page ? traceProbe(page, traceFile) : null;
  const probes = [...cpu.values(), ...alloc.values(), nav, network].filter(Boolean);

  let before, after, windowMs;
  try {
    await Promise.all(targets.map(gc));
    await Promise.all(probes.map((p) => p.start()));
    await trace?.start();
    const tProbes = performance.now();
    before = await sampleAll(ctx);
    const t0 = performance.now();
    try {
      const r = await act();
      if (step.action[0] === "request") result.request = r;
      if (step.action[0] === "eval") result.value = r;
    } catch (e) {
      if (e instanceof TargetLost) throw e;
      checkStopped(e, step.label);
      result.error = e.message;
    }
    result.actionMs = round(performance.now() - t0);
    await sleep(cfg.settle);
    if (page) {
      await nav.untilLoaded(limits.actionMs).catch((e) => {
        if (e instanceof ActionTimeout) throw new RunAborted(`step "${step.label}": the page was still loading ${limits.actionMs}ms after the action (raise --action-timeout); the load would be counted in later steps, so the run stops here`);
        throw e;
      });
      await evaluate(page, TWO_FRAMES).catch((e) => { if (e instanceof TargetLost) throw e; });
    }
    after = await sampleAll(ctx);
    result.wallMs = round(performance.now() - t0);
    windowMs = performance.now() - tProbes;
    await Promise.all([trace?.end(), ...probes.map((p) => p.stop())]);
  } catch (e) {
    await Promise.allSettled([...probes.map((p) => p.stop()), trace?.end().then(() => trace.drain())]);
    if (e instanceof TargetLost || e instanceof RunAborted) throw e;
    return { ...result, error: `measurement failed: ${e.message}` };
  }

  try {
    let afterGc;
    try {
      await Promise.all(targets.map(gc));
      afterGc = await sampleAll(ctx);
    } finally {
      await trace?.drain();
    }
    if (cfg.heapSnapshots) for (const t of targets) artifacts[`${t.name} heapAfter`] = await heapSnapshot(t, art(t, "after.heapsnapshot"));
    for (const t of targets) {
      const c = cpu.get(t)?.result, a = alloc.get(t)?.result;
      if (c && !c.error) writeFileSync((artifacts[`${t.name} cpuprofile`] = art(t, "cpuprofile")), JSON.stringify(c));
      if (a && !a.error) writeFileSync((artifacts[`${t.name} heapprofile`] = art(t, "heapprofile")), JSON.stringify(a));
    }
    if (traceFile) {
      if (trace.error) artifacts.traceError = trace.error;
      else artifacts.trace = traceFile;
    }

    if (page) {
      const [b, a, g] = [before.page, after.page, afterGc.page];
      const mt = mainThread(b, a);
      const navigated = nav.result > 0 || !!mt.countersReset;
      const prof = cfg.profile ? await summarise(cpu.get(page), alloc.get(page), cfg.filter, windowMs) : null;
      const proc = processCpu(b, a, trace.pagePids);
      const lt = trace.result(a.m.Timestamp === undefined ? Infinity : a.m.Timestamp * 1e6);
      result.browser = {
        navigated,
        mainThread: mt,
        processCpuMs: proc.ms,
        processCpuRenderers: proc.renderers,
        ...(proc.exited.length ? { processesExitedMidStep: proc.exited } : {}),
        heap: {
          allocatedBytes: allocated(prof),
          ...(prof?.partial && allocated(prof) !== null ? { allocatedPartial: true } : {}),
          retainedBytes: navigated ? null : g.m.JSHeapUsedSize - b.m.JSHeapUsedSize,
          totalAfterGcBytes: g.m.JSHeapUsedSize,
        },
        dom: navigated ? null : Object.fromEntries(Object.entries(DOM).map(([name, k]) => [name, (g.m[k] ?? 0) - (b.m[k] ?? 0)])),
        domTotalAfterGc: pick(g.m, DOM),
        longTasks: lt.observed ? { ...lt, withProfiler: cfg.profile, withTraceSampler: !!cfg.trace } : lt,
        requests: network.result ?? [],
        profile: prof,
      };
    }
    result.servers = await Promise.all(nodes.map(async (t, i) => {
      const [b, a, g] = [before.nodes[i], after.nodes[i], afterGc.nodes[i]];
      const prof = cfg.profile ? await summarise(cpu.get(t), alloc.get(t), cfg.filter, windowMs) : null;
      return {
        name: t.name,
        argv: t.argv,
        cpuMs: { user: round((a.cpu.user - b.cpu.user) / 1000), system: round((a.cpu.system - b.cpu.system) / 1000) },
        heap: {
          allocatedBytes: allocated(prof),
          ...(prof?.partial && allocated(prof) !== null ? { allocatedPartial: true } : {}),
          retainedBytes: g.mem.heapUsed - b.mem.heapUsed,
          totalAfterGcBytes: g.mem.heapUsed,
        },
        externalRetainedBytes: g.mem.external - b.mem.external,
        rssBytes: g.mem.rss,
        rssDeltaBytes: g.mem.rss - b.mem.rss,
        profile: prof,
      };
    }));
    result.complete = true;
  } catch (e) {
    if (e instanceof TargetLost) throw e;
    result.error = [result.error, `after the measurement window: ${e.message}`].filter(Boolean).join("; ");
  }
  return result;
}

function slope(ys) {
  const n = ys.length;
  const mx = (n - 1) / 2, my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return num / den;
}

function series(vals) {
  const steady = vals.slice(1);
  const out = { afterGc: vals, steadyGrowthPerIteration: steady.length >= 2 ? Math.round(slope(steady)) : null };
  if (steady.length < 3) out.note = "fewer than 3 iterations after warm-up; use --repeat 4 or more for a trend";
  return out;
}

export function leakVerdict(iterations) {
  const last = iterations.map((iter) => iter.at(-1));
  if (last.some((r) => !r.complete)) return { error: "an iteration's last step did not finish, so there is no end-of-iteration total" };
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

function prepareOut(dir) {
  const out = resolve(dir ?? join(tmpdir(), "cdt-runs", new Date().toISOString().replace(/[:.]/g, "-")));
  if (existsSync(out) && readdirSync(out).length) throw new Error(`--out ${out} already has files; pass a new or empty directory`);
  mkdirSync(out, { recursive: true });
  return out;
}

async function setupPage(page, cfg) {
  await page.send("Page.enable");
  await page.send("Performance.enable");
  await page.send("Network.enable");
  await page.send("Inspector.enable");
  await page.send("Page.bringToFront").catch(() => {});
  page.mainFrameId = (await page.send("Page.getFrameTree")).frameTree.frame.id;
  if (cfg.throttle) await page.send("Emulation.setCPUThrottlingRate", { rate: cfg.throttle });
  return async () => {
    if (cfg.throttle) await page.send("Emulation.setCPUThrottlingRate", { rate: 1 });
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
  if (cfg.trace) log("cdt: --trace records JS samples in the browser, so its CPU figures include that sampler's overhead");

  const iterations = [];
  const summary = () => ({
    out: cfg.out,
    page: page?.url,
    servers: nodes.map((t) => ({ name: t.name, argv: t.argv })),
    throttle: cfg.throttle ?? 1,
    profilersOn: cfg.profile,
    traceSamplerOn: cfg.trace,
    steps: iterations.flat(),
  });
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

    for (let i = 0; i < repeat; i++) {
      const iter = [];
      iterations.push(iter);
      for (const [j, step] of steps.entries()) {
        current = `${step.label}${repeat > 1 ? ` #${i + 1}` : ""}`;
        const tag = `${String(j + 1).padStart(2, "0")}-${slug(step.label)}${repeat > 1 ? `-r${i + 1}` : ""}`;
        const r = await measureStep(ctx, step, cfg, tag);
        if (repeat > 1) r.iteration = i + 1;
        iter.push(r);
        appendFileSync(join(cfg.out, "results.jsonl"), JSON.stringify(r) + "\n");
        if (!opts.json) printStep(r);
      }
    }

    const out = summary();
    if (repeat > 1) out.leak = leakVerdict(iterations);
    writeFileSync(join(cfg.out, "summary.json"), JSON.stringify(out, null, 2));
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else if (out.leak) printLeak(out.leak);
    if (out.steps.some((s) => s.error)) process.exitCode = 1;
  } catch (e) {
    if (!(e instanceof TargetLost || e instanceof RunAborted)) throw e;
    const why = e instanceof TargetLost ? `lost a target during step "${current}": ${e.message}` : e.message;
    writeFileSync(join(cfg.out, "summary.json"), JSON.stringify({ ...summary(), aborted: why }, null, 2));
    throw new Error(`${why}. Steps finished before it are in ${join(cfg.out, "summary.json")}`);
  } finally {
    await teardown?.().catch(() => {});
    page?.cdp.close();
    nodes.forEach((t) => t.cdp.close());
  }
}
