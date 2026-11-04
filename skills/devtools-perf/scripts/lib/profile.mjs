import { loadMap, lookup, resolveSource } from "./sourcemap.mjs";
import { round } from "./util.mjs";

const SKIP_FRAMES = new Set(["(idle)", "(root)"]);

const VENDOR = /node_modules|next-sourcemaps-hook\.cjs|^(node:|internal\/|evalmachine|(turbopack:\/\/\/)?\[(turbopack|externals)\])/;
const BUNDLE_CHUNK = /\/_next\/|\.next\/|\/cdt-profile\//;

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

function isApp(url, source, mapped) {
  if (!source || VENDOR.test(url) || VENDOR.test(source)) return false;
  return mapped || !BUNDLE_CHUNK.test(url);
}

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
      own: !!url && !VENDOR.test(url),
      mapped: !!hit?.source,
      url,
      mapError: loaded?.error,
    });
  }
  return out;
}

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

function sampleWeights(profile) {
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas;
  if (!deltas) return samples.map(() => (profile.endTime - profile.startTime) / samples.length);
  const at = [];
  let t = profile.startTime;
  for (const d of deltas) at.push((t += d));
  const mean = samples.length > 1 ? (at.at(-1) - at[0]) / (samples.length - 1) : 0;
  return at.map((ti, i) => Math.max(0, (i + 1 < at.length ? at[i + 1] : Math.min(ti + mean, profile.endTime)) - ti));
}

export async function cpuSummary(profile, filter, n = 8) {
  const samples = profile.samples ?? [];
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of profile.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const frames = await describeFrames(profile.nodes, filter);
  const weights = new Map();
  let sampledUs = 0;
  sampleWeights(profile).forEach((w, i) => {
    sampledUs += w;
    const leaf = samples[i];
    if (!SKIP_FRAMES.has(nodes.get(leaf).callFrame.functionName)) weights.set(leaf, (weights.get(leaf) ?? 0) + w);
  });
  return {
    ...attribute(weights, parent, frames, n, (us) => ({ ms: round(us / 1000) })),
    sampledMs: round(sampledUs / 1000),
    profileMs: round((profile.endTime - profile.startTime) / 1000),
  };
}

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
