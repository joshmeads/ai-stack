// Text summary of measured steps.

import { round } from "./util.mjs";

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";

export function size(bytes, signed = true) {
  if (bytes === null || bytes === undefined) return "n/a";
  const sign = !signed ? "" : bytes < 0 ? "-" : "+";
  const a = Math.abs(bytes);
  return a >= 1 << 20 ? `${sign}${round(a / (1 << 20))}MB` : `${sign}${round(a / 1024)}KB`;
}

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const list = (items, fmt) => items.slice(0, 5).map(fmt).join("; ");
const ms = (f) => `${f.fn} ${f.ms}ms`;
const bytes = (f) => `${f.fn} ${size(f.bytes, false)}`;

function shortUrl(u) {
  try {
    const x = new URL(u);
    return (x.pathname + x.search).slice(0, 60);
  } catch {
    return u.slice(0, 60);
  }
}

const scriptName = (u) => u.split("?")[0].split("/").slice(-2).join("/");

function printProfile(indent, prof) {
  if (!prof) return;
  const { cpu, alloc } = prof;
  if (cpu?.error) console.log(`${indent} cpu profile unavailable: ${cpu.error}`);
  else if (cpu) {
    if (cpu.self.length) console.log(`${indent} top self: ${list(cpu.self, ms)}`);
    if (cpu.appTotal.length) console.log(`${indent} app total: ${list(cpu.appTotal, ms)}`);
    if (cpu.appSelf.length) console.log(`${indent} app self (incl. library calls): ${list(cpu.appSelf, ms)}`);
    const c = cpu.coverage;
    if (c.resolvedPct !== null) {
      const missing = c.unmappedScripts.slice(0, 3).map((s) => `${scriptName(s.url)} (${s.why})`).join(", ");
      const more = c.unmappedScripts.length > 3 ? ` +${c.unmappedScripts.length - 3} more` : "";
      console.log(`${indent} source maps: ${c.resolvedPct}% of ${c.ownScripts.ms}ms in non-library scripts resolved${missing ? `; unresolved: ${missing}${more}` : ""}`);
    }
  }
  if (alloc?.error) console.log(`${indent} allocation profile unavailable: ${alloc.error}`);
  else if (alloc?.appSelf.length) console.log(`${indent} app allocations: ${list(alloc.appSelf, bytes)}`);
}

function heapLine(h) {
  const alloc = h.allocatedBytes === null ? "" : `${size(h.allocatedBytes, false)} allocated, `;
  const retained = h.retainedBytes === null ? "" : `${size(h.retainedBytes)} retained after GC, `;
  return `${alloc}${retained}total after GC ${size(h.totalAfterGcBytes, false)}`;
}

export function printStep(r) {
  const it = r.iteration ? ` #${r.iteration}` : "";
  const timing = r.wallMs === undefined ? "" : ` wall ${r.wallMs}ms (action ${r.actionMs}ms)`;
  console.log(`[${r.label}${it}]${timing}${r.error ? ` ERROR ${r.error}` : ""}`);
  if ("value" in r) console.log(`  returned ${(JSON.stringify(r.value) ?? "undefined").slice(0, 200)}`);
  if (r.request) console.log(`  request ${r.request.method} ${r.request.url} → ${r.request.status}, ttfb ${r.request.ttfbMs}ms, ${size(r.request.bytes, false)}`);
  const b = r.browser;
  if (b) {
    const mt = b.mainThread;
    const procs = Object.entries(b.processCpuMs).filter(([, v]) => v > 0.5).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    if (b.navigated) console.log("  navigated: browser heap and DOM are totals after GC, not deltas");
    if (mt.countersReset) console.log("  main-thread counters restarted in a new renderer: figures cover the new document only");
    console.log(`  browser main thread ${mt.taskMs}ms: script ${mt.scriptMs}, layout ${mt.layoutMs} (${mt.layouts}x), style ${mt.styleMs} (${mt.styleRecalcs}x)${procs ? ` | process cpu ms: ${procs}` : ""}`);
    const dom = b.dom
      ? `dom nodes ${signed(b.dom.nodes)}, listeners ${signed(b.dom.listeners)}`
      : `dom nodes ${b.domTotalAfterGc.nodes}, listeners ${b.domTotalAfterGc.listeners} (totals)`;
    console.log(`  browser heap ${heapLine(b.heap)} | ${dom}`);
    const lt = b.longTasks;
    if (lt?.error) console.log(`  long tasks: not observed (${lt.error})`);
    else if (lt && !lt.observed) console.log(`  long tasks: not observed (${lt.reason})`);
    else if (lt?.longTasksMs.length) console.log(`  long tasks ${lt.longTasksMs.length} (max ${Math.max(...lt.longTasksMs)}ms, total ${lt.longTasksMs.reduce((x, y) => x + y, 0)}ms)`);
    else if (lt) console.log("  long tasks: none");
    if (b.requests.length) console.log(`  requests: ${b.requests.slice(0, 8).map((q) => `${q.method} ${shortUrl(q.url)} ${q.status ?? "?"} ${q.ms ?? "?"}ms`).join("; ")}${b.requests.length > 8 ? ` (+${b.requests.length - 8} more)` : ""}`);
    printProfile("  browser", b.profile);
  }
  for (const s of r.servers ?? []) {
    console.log(`  ${s.name} cpu ${round(s.cpuMs.user + s.cpuMs.system)}ms (user ${s.cpuMs.user}, sys ${s.cpuMs.system}) | heap ${heapLine(s.heap)} | external ${size(s.externalRetainedBytes)} | rss ${size(s.rssBytes, false)}`);
    printProfile("   ", s.profile);
  }
}

export function printLeak(leak) {
  if (leak.error) return void console.log(`leak check: ${leak.error}`);
  console.log("leak check (totals after GC at the end of each iteration; iteration 1 is warm-up):");
  const line = (name, s, fmt) => {
    const growth = s.steadyGrowthPerIteration === null ? "" : `, steady growth ${fmt(s.steadyGrowthPerIteration, true)}/iteration`;
    console.log(`  ${name}: ${s.afterGc.map((x) => fmt(x, false)).join(" → ")}${growth}${s.note ? ` (${s.note})` : ""}`);
  };
  const count = (n, sgn) => (sgn ? signed(n) : String(n));
  for (const [name, l] of Object.entries(leak)) {
    line(`${name} heap`, l.heapBytes, size);
    if (l.domNodes) line(`${name} dom nodes`, l.domNodes, count);
    if (l.listeners) line(`${name} listeners`, l.listeners, count);
  }
}
