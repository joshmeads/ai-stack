// Profiles report generated positions. Bundled, minified code (Next.js
// production) is unreadable without mapping back to the original source.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

// One array of segments per generated line. A segment is
// [col, src, srcLine, srcCol, name] or, for generated code that maps to
// nothing (a one-field segment in the spec), just [col].
export function decodeMappings(str) {
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
      } else {
        segs.push([col]);
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
  // Before the first segment, or inside an unmapped region: no mapping.
  if (!hit || hit.length === 1) return null;
  const [, s, sl, , n] = hit;
  const text = map.sourcesContent?.[s]?.split("\n")[sl];
  return { source: map.sources[s], line: sl + 1, name: n >= 0 ? map.names[n] : null, text };
}

// Index maps (Turbopack) hold sections with their own offsets.
export function lookup(map, line, col) {
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

async function readUrl(url) {
  if (url.startsWith("data:")) {
    const [meta, data] = url.split(",", 2);
    return meta.endsWith(";base64") ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data);
  }
  if (url.startsWith("file://")) {
    const path = fileURLToPath(url);
    if (!existsSync(path)) throw new Error("file missing");
    return readFileSync(path, "utf8");
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const mapCache = new Map();

// A map must come from where its script came from: same origin for http(s),
// the local disk only for a local script. Inline data: maps are fine.
function sameOrigin(scriptUrl, mapUrl) {
  if (mapUrl.startsWith("data:")) return true;
  const a = new URL(scriptUrl), b = new URL(mapUrl);
  return a.protocol === b.protocol && (a.protocol === "file:" || a.origin === b.origin);
}

// Follows the script's own sourceMappingURL comment (bundlers such as
// Turbopack name maps by content hash), falling back to <script>.map.
// Returns { map } or { error } and caches either for the run.
export async function loadMap(url) {
  if (mapCache.has(url)) return mapCache.get(url);
  let entry;
  const scriptUrl = url.startsWith("/") ? `file://${url}` : url;
  if (!/^(file|https?):/.test(scriptUrl)) entry = { error: "not a file or http URL" };
  else {
    try {
      const code = await readUrl(scriptUrl);
      const ref = code.match(/\/\/[#@] sourceMappingURL=(\S+)\s*$/)?.[1];
      const mapUrl = ref ? new URL(ref, scriptUrl).href : `${scriptUrl.split("?")[0]}.map`;
      if (!sameOrigin(scriptUrl, mapUrl)) entry = { error: "map is not on the script's origin, so it was not read" };
      else {
        try {
          entry = { map: JSON.parse(await readUrl(mapUrl)) };
        } catch (e) {
          const why = e instanceof SyntaxError ? "not valid JSON" : e.message;
          entry = { error: `${ref ? "map" : "no sourceMappingURL; guessed .map"}: ${why}` };
        }
      }
    } catch (e) {
      entry = { error: `script: ${e.name === "TimeoutError" ? "timed out" : e.message}` };
    }
  }
  mapCache.set(url, entry);
  return entry;
}

// Place the original source on disk where possible and show it relative to the
// project (the dir above .next/, else cwd).
export function resolveSource(generatedUrl, source) {
  const gen = generatedUrl.replace(/^file:\/\//, "");
  const root = gen.includes("/.next/") ? gen.slice(0, gen.indexOf("/.next/")) : process.cwd();
  let s = source.replace(/^turbopack:\/\/\/\[project\]\//, `${root}/`).replace(/^file:\/\//, "");
  if (/^webpack(-internal)?:\/\//.test(s)) return s.replace(/^webpack(-internal)?:\/\/\/?(\([^)]*\)\/)?(\.\/)?/, "");
  if (!/^[a-z]+:/.test(s) && !isAbsolute(s) && isAbsolute(gen)) s = resolve(dirname(gen), s);
  return isAbsolute(s) && s.startsWith(`${root}/`) ? relative(root, s) : s;
}
