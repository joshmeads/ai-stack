// Turns CPU profiles and sampling heap profiles into top-function lists,
// resolving generated positions through source maps.

import { loadMap, lookup, resolveSource } from "./sourcemap.mjs";
import { round } from "./util.mjs";

const SKIP_FRAMES = new Set(["(idle)", "(root)"]);

const VENDOR = /node_modules|^(node:|internal\/|evalmachine|(turbopack:\/\/\/)?\[(turbopack|externals)\])/;
const BUNDLE_CHUNK = /\/_next\/|\.next\//;

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

// Your code: the running file is not a dependency, and the original source
// (when a map resolves it) is not one either. Unmapped bundle chunks
// (/_next/, .next/) are unknown, so they stay out of the app lists.
function isApp(url, source, mapped) {
  if (!source || VENDOR.test(url) || VENDOR.test(source)) return false;
  return mapped || !BUNDLE_CHUNK.test(url);
}

// nodes: [{ id, callFrame }]. Returns id -> frame description.
async function describeFrames(nodes, filter) {
  const out = new Map();
  for (const x of nodes) {
    const f = x.callFrame;
    const url = f.url ?? "";
    const loaded = url ? await loadMap(url) : null;
    const hit = loaded?.map ? lookup(loaded.map, f.lineNumber, f.columnNumber) : null;
    let name = f.functionName || "(anonymous)";
    let where, source;
    if (hit?.source) {
      source = resolveSource(url, hit.source);
      if (name === "(anonymous)" || name.length <= 2) name = hit.name ?? guessName(hit.text) ?? name;
      where = `${source}:${hit.line}`;
    } else if (url) {
      source = resolveSource(url, url.split("?")[0]);
      where = `${source.split("/").slice(-3).join("/")}:${f.lineNumber + 1}`;
    }
    const app = isApp(url, source, !!hit?.source) && (!filter || source.includes(filter));
    out.set(x.id, {
      key: where ? `${name} ${where}` : name,
      app,
      // Whether this frame is in a non-library script, and whether a map
      // resolved it: the basis for the coverage line.
      own: !!url && !VENDOR.test(url),
      mapped: !!hit?.source,
      url,
      mapError: loaded?.error,
    });
  }
  return out;
}

// Attribution shared by CPU samples and allocation samples: weight lands on
// the leaf (self), on the nearest app frame (appSelf: library time called
// from your function counts as yours) and once on every app frame on the
// stack (appTotal).
function attribute(weights, parent, frames, n, fmt) {
  const self = new Map(), appSelf = new Map(), appTotal = new Map();
  const bump = (m, k, w) => m.set(k, (m.get(k) ?? 0) + w);
  let ownW = 0, mappedW = 0;
  const unmapped = new Map();
  for (const [leaf, w] of weights) {
    const fr = frames.get(leaf);
    bump(self, fr.key, w);
    if (fr.own) {
      ownW += w;
      if (fr.mapped) mappedW += w;
      else unmapped.set(fr.url, fr.mapError ?? "no mapping for this position");
    }
    let owner = leaf;
    while (owner !== undefined && !frames.get(owner).app) owner = parent.get(owner);
    if (owner !== undefined) bump(appSelf, frames.get(owner).key, w);
    const seen = new Set();
    for (let id = leaf; id !== undefined; id = parent.get(id)) {
      const f = frames.get(id);
      if (f.app && !seen.has(f.key)) { seen.add(f.key); bump(appTotal, f.key, w); }
    }
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, w]) => ({ fn, ...fmt(w) }));
  const coverage = {
    ownScripts: fmt(ownW),
    resolvedPct: ownW ? round((100 * mappedW) / ownW) : null,
    unmappedScripts: [...unmapped].map(([url, why]) => ({ url, why })),
  };
  return { self: top(self), appSelf: top(appSelf), appTotal: top(appTotal), coverage };
}

// self: time with the function at the top of the stack.
// total: inclusive time, counted once per sample even under recursion.
export async function cpuSummary(profile, filter, n = 8) {
  const samples = profile.samples ?? [];
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const frames = await describeFrames(profile.nodes, filter);
  const counts = new Map();
  for (const leaf of samples) {
    if (SKIP_FRAMES.has(nodes.get(leaf).callFrame.functionName)) continue;
    counts.set(leaf, (counts.get(leaf) ?? 0) + 1);
  }
  const usPerSample = samples.length ? (profile.endTime - profile.startTime) / samples.length : 0;
  return attribute(counts, parent, frames, n, (hits) => ({ ms: round((hits * usPerSample) / 1000) }));
}

// Sampling heap profile (HeapProfiler.stopSampling, including objects
// already collected): bytes allocated during the window, per function.
export async function allocSummary(profile, filter, n = 8) {
  const list = [];
  const parent = new Map();
  const walk = (node, parentId) => {
    list.push(node);
    if (parentId !== undefined) parent.set(node.id, parentId);
    for (const c of node.children ?? []) walk(c, node.id);
  };
  walk(profile.head);
  const weights = new Map();
  let allocatedBytes = 0;
  for (const x of list) {
    if (!x.selfSize) continue;
    allocatedBytes += x.selfSize;
    weights.set(x.id, x.selfSize);
  }
  const frames = await describeFrames(list, filter);
  return { allocatedBytes, ...attribute(weights, parent, frames, n, (bytes) => ({ bytes })) };
}
