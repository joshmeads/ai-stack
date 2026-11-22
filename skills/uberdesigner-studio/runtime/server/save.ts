// Saving from the panel: site-wide token values, a layer's own values, words, fonts. Everything is checked first and
// worked out in full, then written once.

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TAG, selectorsOf } from "./address.ts";
import { htmlEntry } from "./adapters.ts";
import { addFontLink, fontList } from "./direct.ts";
import { cssOfFile, rootTokens } from "./reconcile.ts";
import { valueProblem } from "./values.ts";
import { cssIntact, cssMask, depthAt, savePartTokens, TOKEN_NAME, TOKEN_VALUE } from "./css-write.ts";
import { record, recordOutside, withWriteLock } from "./history.ts";
import { body, reply } from "./http.ts";
import { codeTags } from "./map-check.ts";
import { type DesignMap, readMap, ROOT, safePath, STATE } from "./site.ts";

export async function save(req: IncomingMessage, res: ServerResponse) {
  const { tokens = {}, parts = {}, found, content, fonts = [] } = JSON.parse(await body(req)) as {
    tokens?: Record<string, string>;
    parts?: Record<string, Record<string, string>>;
    found?: Record<string, number>; // how many elements each of those layers has on the page now, as the panel sees it
    content?: unknown;
    fonts?: string[]; // Google font families the new values use, added to the page's <head>
  };
  await withWriteLock(async () => {
    // Before the font link or anything else is written
    const tokensFile = readMap().tokensFile;
    if (tokensFile) checkSavedValues(tokensFile, readFileSync(safePath(tokensFile), "utf8"), tokens, parts);
    checkLayersExist(parts, found);
    await addFonts(fonts);
    await saveNow(res, tokens, parts, content);
  });
}

// The page file whose <head> loads the fonts: a Vite project's index.html, or a plain site's page
export const pageFile = () => (existsSync(join(ROOT, "index.html")) ? "index.html" : htmlEntry(ROOT));
export async function addFonts(families: string[]) {
  if (!families.length) return;
  const page = pageFile();
  if (!page) throw new Error("No page file to add the font to");
  const { fonts } = await fontList(STATE);
  let html = readFileSync(safePath(page), "utf8");
  for (const family of families) {
    const f = fonts.find((x) => x.family === family);
    if (f) html = addFontLink(html, f) ?? html; // not a Google font (a system font): nothing to load
  }
  writeFileSync(safePath(page), html);
}

// Every value is checked before anything is written: it must be safe inside its declaration, and a colour token takes
// a colour (values.ts). One bad value stops the whole save, so a save is never half written.
export function checkSavedValues(tokensFile: string, css: string, tokens: Record<string, string>, parts: Record<string, Record<string, string>>) {
  const described = (readMap() as DesignMap & { tokens?: Record<string, { label?: string }> }).tokens ?? {};
  const now = rootTokens(cssOfFile(tokensFile, css));
  const check = (name: string, value: unknown, layer?: string) => {
    if (typeof value !== "string") throw new Error(`Not a token value: ${name}`);
    const why = valueProblem(value, name.startsWith("--") ? now.get(name) : undefined);
    if (why) throw new Error(`${described[name]?.label ?? name}${layer ? ` on ${layer}` : ""} wasn't saved: ${why}. Nothing was written.`);
  };
  for (const [name, value] of Object.entries(tokens)) check(name, value);
  for (const [id, values] of Object.entries(parts)) {
    if (!values || typeof values !== "object") continue;
    const layer = readMap().parts?.find((p) => p.id === id)?.label ?? id;
    for (const [name, value] of Object.entries(values)) check(name, value, layer);
  }
}

// A value saved for one layer is a rule under the layer's tag or address. If nothing carries that tag or matches that
// address, the rule is dead: the file changes and the page doesn't. Two checks before anything is written. The code:
// a layer with no selector address must be tagged somewhere. The page: when the panel says how many elements the
// layer has now (it sends the count), none means the same thing.
export function checkLayersExist(parts: Record<string, Record<string, string>>, found: Record<string, number> | undefined) {
  const ids = Object.entries(parts).filter(([, v]) => v && typeof v === "object" && Object.keys(v).length).map(([id]) => id);
  if (!ids.length) return;
  const map = readMap();
  let tags: Set<string> | null = null;
  for (const id of ids) {
    const part = map.parts?.find((p) => p.id === id);
    const label = part?.label ?? id;
    const addressed = !!part && selectorsOf(part).length > 0;
    if (!addressed && !(tags ??= codeTags()).has(id))
      throw new Error(`${label} wasn't saved: nothing in the code is tagged ${TAG}="${id}", so a value saved for this layer alone would change nothing. Nothing was written.`);
    if (found && found[id] === 0)
      throw new Error(`${label} wasn't saved: it isn't on the page now, so a value saved for this layer alone would change nothing. Nothing was written.`);
  }
}

export async function saveNow(res: ServerResponse, tokens: Record<string, string>, parts: Record<string, Record<string, string>>, content: unknown) {
  const missing: string[] = [];
  const entries = Object.entries(tokens);
  const partEntries = Object.entries(parts).filter(([, v]) => v && Object.keys(v).length);
  // Worked out in full first, written once: the layers' own rules, then the site-wide tokens
  let tokensPath: string | null = null;
  let next = "";
  if (partEntries.length || entries.length) {
    const tokensFile = readMap().tokensFile;
    if (!tokensFile) throw new Error("This project's map names no tokens file");
    tokensPath = safePath(tokensFile);
    const css = readFileSync(tokensPath, "utf8");
    checkSavedValues(tokensFile, css, tokens, Object.fromEntries(partEntries));
    next = css;
    for (const [id, values] of partEntries) next = savePartTokens(tokensFile, next, readMap().parts?.find((p) => p.id === id) ?? { id }, values);
    // Plain :root blocks (not inside a media query); the effective value is in the last one that defines a token
    for (const [name, value] of entries) {
      if (!TOKEN_NAME.test(name) || !TOKEN_VALUE.test(value)) throw new Error(`Not a token value: ${name}: ${value}`);
      const masked = cssMask(tokensFile, next);
      const blocks = [...masked.matchAll(/:root\s*\{[^}]*\}/g)].filter((m) => depthAt(masked, m.index ?? 0) === 0);
      const re = new RegExp(`((?:^|[\\s;{])${name}\\s*:\\s*)([^;]+)(;)`);
      const block = [...blocks].reverse().find((b) => re.test(b[0]));
      if (!block || block.index === undefined) {
        missing.push(name);
        continue;
      }
      const at = block.index;
      const replaced = next.slice(at, at + block[0].length).replace(re, (_m, a: string, _old: string, c: string) => `${a}${value.trim()}${c}`);
      next = next.slice(0, at) + replaced + next.slice(at + block[0].length);
    }
    if (!cssIntact(tokensFile, css, next)) throw new Error(`Saving would leave ${tokensFile} with an unclosed rule, so nothing was written. Please report this: it's a fault in uberdesigner studio.`);
  }
  let wordsPath: string | null = null;
  if (content && typeof content === "object") {
    const words = readMap().content?.file;
    if (!words) throw new Error("This project's map names no words file");
    wordsPath = safePath(words);
  }
  await recordOutside();
  if (tokensPath) writeFileSync(tokensPath, next);
  if (wordsPath) writeFileSync(wordsPath, JSON.stringify(content, null, 2) + "\n");
  const changed = [...entries.map(([n]) => n), ...partEntries.flatMap(([id, v]) => Object.keys(v).map((n) => `${n} on ${id}`)), ...(content ? ["words"] : [])];
  await record({ kind: "save", label: `Saved ${changed.length > 3 ? `${changed.length} changes` : changed.join(", ")} from the studio` });
  reply(res, 200, { ok: true, missing });
}
