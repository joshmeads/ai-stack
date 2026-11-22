// Changes the inspector writes into the site's files itself, with no Claude call, when it can be sure where they go:
// a link's address or an image's source written out once as a string in the part's files, an effect's number set as
// a constant (const RISE = 0.07), a Google font added to the page's <head>. Anything less certain is handed to
// Claude as an ordinary change of the part (the caller does that), as typed text is (text.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { TAG } from "./address.ts";

type PartLike = { id: string; edit: string[]; files?: string[] };
type MapLike = { content?: { file: string } | null; extraFiles?: string[] };
export type Swap = { file: string; start: number; end: number; insert: string };
export type Found = { ok: true; swap: Swap } | { ok: false; why: string };

const clean = (f: string) => f.replace(/\s*\(.*\)$/, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// The files a part's strings may live in: its own, the words file and the shared files. Not a Vite project's
// index.html unless the map lists it: its preload links repeat image addresses the components use. (A plain site's
// page is in its parts' own files.)
export function searchFiles(part: PartLike, map: MapLike, exists: (f: string) => boolean): string[] {
  const c = map.content as { file?: string } | string | null | undefined;
  const words = typeof c === "string" ? c : c?.file; // some maps name the words file as a plain string
  return [...new Set([...part.edit, ...(part.files ?? []), ...(words ? [words] : []), ...(map.extraFiles ?? [])].filter((f): f is string => typeof f === "string").map(clean))].filter(
    (f) => /\.(tsx?|jsx?|mjs|json|html?)$/.test(f) && exists(f),
  );
}

// A string value written out exactly once, in quotes (or as an attribute value), across those files
export function findString(files: string[], from: string, read: (f: string) => string | null, partId?: string): Found {
  if (!from) return { ok: false, why: "there was no value to look for" };
  const re = new RegExp(`(["'\`])${escapeRe(from)}\\1`, "g");
  const hits: Swap[] = [];
  for (const file of files) {
    const text = read(file);
    if (!text) continue;
    for (const m of text.matchAll(re)) {
      const start = (m.index ?? 0) + 1;
      hits.push({ file, start, end: start + from.length, insert: "" });
    }
  }
  if (!hits.length) return { ok: false, why: `"${from}" isn't written out as a string in the part's files (the code builds it)` };
  if (hits.length > 1 && partId) {
    // Written more than once, but once in the part's own tag (<a data-dm="tickets" href="#dates">): that one
    const own = hits.filter((h) => {
      const text = read(h.file) ?? "";
      const open = text.lastIndexOf("<", h.start);
      const tag = text.slice(open, h.start);
      return open >= 0 && !tag.includes(">") && new RegExp(`${TAG}=["']${escapeRe(partId)}["']`).test(tag + text.slice(h.start, text.indexOf(">", h.start)));
    });
    if (own.length === 1) return { ok: true, swap: own[0] };
  }
  if (hits.length > 1) return { ok: false, why: `"${from}" is written ${hits.length} times, so it's not clear which one is this part's` };
  return { ok: true, swap: hits[0] };
}

const NUMBER_CONST = (name: string) => new RegExp(`(\\b(?:const|let|var)\\s+${escapeRe(name)}\\s*(?::\\s*number\\s*)?=\\s*)(-?[\\d.]+(?:e-?\\d+)?)`);

// An effect's setting, from the map: a number constant by name (const RISE = 0.07), or the number right after a
// piece of code written once in the file ("smoothstep(" in a shader: smoothstep(0.56, …)). GLSL floats keep their dot.
// "nth" picks a later number after the find (1 = the second): the 0.8 of "copyRise: [0.2, 0.8]" stays found when the
// first number changes.
export type ParamRef = { name?: string; find?: string; nth?: number };
const AFTER = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e-?\d+)?)/; // GLSL writes .8 for 0.8
function locateParam(text: string, p: ParamRef): { start: number; end: number; raw: string } | null {
  if (p.find) {
    const at = text.indexOf(p.find);
    if (at < 0 || text.indexOf(p.find, at + 1) >= 0) return null;
    let from = at + p.find.length;
    for (let k = 0; k < (p.nth ?? 0); k++) {
      // Skip a number and what separates it from the next one (", " in a list or a call)
      const skip = text.slice(from).match(/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:e-?\d+)?\s*[,;]?/);
      if (!skip) return null;
      from += skip[0].length;
    }
    const m = text.slice(from).match(AFTER);
    if (!m) return null;
    const start = from + m[0].length - m[1].length;
    return { start, end: start + m[1].length, raw: m[1] };
  }
  if (!p.name) return null;
  const m = NUMBER_CONST(p.name).exec(text);
  if (!m) return null;
  const start = (m.index ?? 0) + m[1].length;
  return { start, end: start + m[2].length, raw: m[2] };
}
export function readNumber(text: string, p: ParamRef): number | null {
  const at = locateParam(text, p);
  return at ? Number(at.raw) : null;
}
export function setNumber(text: string, p: ParamRef, value: number): string | null {
  const at = locateParam(text, p);
  if (!at || !Number.isFinite(value)) return null;
  let out = String(+value.toFixed(6));
  if (at.raw.includes(".") && !out.includes(".")) out += ".0"; // a float in a shader stays a float
  if (/^-?\./.test(at.raw)) out = out.replace(/^(-?)0\./, "$1."); // written as .8: stays without the 0
  return text.slice(0, at.start) + out + text.slice(at.end);
}

// --- Google Fonts: the public family list (no key needed), cached in the inspector's folder for a week

export type FontFamily = { family: string; category: string; popularity: number; weights: number[]; wght: [number, number] | null; italic: boolean };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Used when the list can't be fetched (offline): a few of the most used families
const FALLBACK: FontFamily[] = [
  ["Inter", "Sans Serif", [100, 900]],
  ["Roboto", "Sans Serif", [100, 900]],
  ["Open Sans", "Sans Serif", [300, 800]],
  ["Montserrat", "Sans Serif", [100, 900]],
  ["Poppins", "Sans Serif", null],
  ["DM Sans", "Sans Serif", [100, 1000]],
  ["Manrope", "Sans Serif", [200, 800]],
  ["Space Grotesk", "Sans Serif", [300, 700]],
  ["Geist", "Sans Serif", [100, 900]],
  ["Mona Sans", "Sans Serif", [200, 900]],
  ["Playfair Display", "Serif", [400, 900]],
  ["Fraunces", "Serif", [100, 900]],
  ["Instrument Serif", "Serif", null],
  ["Lora", "Serif", [400, 700]],
  ["JetBrains Mono", "Monospace", [100, 800]],
  ["Bebas Neue", "Display", null],
].map(([family, category, range], i) => ({
  family: family as string,
  category: category as string,
  popularity: i + 1,
  weights: range ? [] : [400],
  wght: range as [number, number] | null,
  italic: false,
}));

export async function fontList(stateDir: string): Promise<{ fonts: FontFamily[]; source: "google" | "fallback" }> {
  const cache = join(stateDir, "fonts.json");
  try {
    const kept = JSON.parse(readFileSync(cache, "utf8")) as { at: number; fonts: FontFamily[] };
    if (Date.now() - kept.at < WEEK_MS && kept.fonts.length) return { fonts: kept.fonts, source: "google" };
  } catch {
    /* not cached yet */
  }
  try {
    const res = await fetch("https://fonts.google.com/metadata/fonts", { signal: AbortSignal.timeout(15000) });
    const raw = (await res.text()).replace(/^\)\]\}'\s*/, "");
    const data = JSON.parse(raw) as {
      familyMetadataList: { family: string; category: string; popularity: number; axes?: { tag: string; min: number; max: number }[]; fonts?: Record<string, unknown> }[];
    };
    const fonts = data.familyMetadataList
      .map((f) => {
        const styles = Object.keys(f.fonts ?? {});
        const wght = f.axes?.find((a) => a.tag === "wght");
        return {
          family: f.family,
          category: f.category,
          popularity: f.popularity,
          weights: wght ? [] : [...new Set(styles.map((s) => parseInt(s, 10)).filter((n) => n > 0))].sort((a, b) => a - b),
          wght: wght ? ([wght.min, wght.max] as [number, number]) : null,
          italic: styles.some((s) => s.endsWith("i")),
        };
      })
      .sort((a, b) => a.popularity - b.popularity);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(cache, JSON.stringify({ at: Date.now(), fonts }));
    return { fonts, source: "google" };
  } catch {
    return { fonts: FALLBACK, source: "fallback" };
  }
}

// The stylesheet address that loads a family with every weight it has
export function fontHref(f: Pick<FontFamily, "family" | "weights" | "wght">): string {
  const name = f.family.trim().replace(/ /g, "+");
  const axis = f.wght ? `:wght@${f.wght[0]}..${f.wght[1]}` : f.weights.length > 1 ? `:wght@${f.weights.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${name}${axis}&display=swap`;
}

// Add a family's stylesheet to the page's <head>, unless the page loads that family already
export function addFontLink(html: string, f: Pick<FontFamily, "family" | "weights" | "wght">): string | null {
  const plus = f.family.replace(/ /g, "+");
  if (html.includes(`family=${plus}:`) || html.includes(`family=${plus}&`) || html.includes(`data-inspector-font="${f.family}"`)) return null;
  const tag = `    <link rel="stylesheet" href="${fontHref(f).replace(/&/g, "&amp;")}" data-inspector-font="${f.family}" />\n`;
  const head = html.search(/<\/head>/i);
  if (head < 0) return null;
  const at = html.lastIndexOf("\n", head) + 1; // the start of the </head> line, so its indent stays
  return html.slice(0, at) + tag + html.slice(at);
}

// --- Media: a picture or video the person picked on their computer, saved into the site

const MEDIA = /^\.(png|jpe?g|webp|avif|gif|svg|mp4|webm|mov)$/i;
export function saveMedia(root: string, publicDir: string, name: string, data: Buffer): { path: string; url: string } {
  const ext = extname(name).toLowerCase();
  if (!MEDIA.test(ext)) throw new Error("Pick an image (png, jpg, webp, avif, gif, svg) or a video (mp4, webm, mov)");
  const stem =
    basename(name, extname(name))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "media";
  const dir = join(root, publicDir, "media");
  mkdirSync(dir, { recursive: true });
  let file = `${stem}${ext}`;
  for (let i = 2; existsSync(join(dir, file)); i++) file = `${stem}-${i}${ext}`;
  writeFileSync(join(dir, file), data);
  const rel = `${publicDir ? `${publicDir}/` : ""}media/${file}`;
  return { path: rel, url: publicDir === "public" ? `/media/${file}` : `media/${file}` };
}
