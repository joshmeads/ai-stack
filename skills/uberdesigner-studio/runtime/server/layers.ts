// An object the person picked inside a layer (panel objects.ts) becomes a layer of the map: when it is changed for
// the first time, or kept on purpose. Nothing is asked of Claude. Where the page is a plain HTML file and the element
// can be found in it for certain (html-tree.ts), its tag is written into the source like any layer's, as a version
// in History: its changes then send its own lines, not its whole section. Where it can't (a component's markup,
// content a script builds, a source the scan can't follow), the map keeps its address on the page and no file is
// touched. The answer says which, and whether the words on the page aren't the words in the file (a script sets them).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { selectorProblem, TAG, tagTargetsOf } from "./address.ts";
import { ownWrites } from "./direct-changes.ts";
import { record, recordOutside, withWriteLock } from "./history.ts";
import { attrOf, elementAt, plainWords, type Step } from "./html-tree.ts";
import { type MapEntry, writeMap } from "./map-store.ts";
import { ROOT, safePath } from "./site.ts";

export type PickedLayer = {
  id: string;
  label: string;
  kind?: string;
  anchor: string; // the tagged layer its address starts from, or PAGE: in no layer, addressed from the page
  which?: { nth: number; of: number }; // when that layer has several elements: which of them, in page order
  listedIn?: string; // the layer it was found in (may be the anchor, or a layer between)
  selector: string;
  path: Step[];
  several?: number; // several elements of one kind offered as one layer (panel suggest.ts): how many; no path then
  tag: string;
  classes: string; // as the page has them
  words: string; // its words on the page, the first of them
  src?: string; // a picture's or a video's file
  tokens?: string[];
};
export type Kept = { id: string; tagged: boolean; file?: string; why?: string; scripted?: boolean };

// The page itself as the outer layer: an object no layer holds (panel objects.ts PAGE), addressed from an id around it
// or from <body>. It is kept by that address; no file is touched (nothing tagged in the code holds it).
const PAGE = "@page";
const KINDS = ["section", "frame", "text", "image", "video", "button", "icon", "scene", "list"];
const fileOf = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "");

export async function keepLayer(def: PickedLayer): Promise<Kept> {
  if (!/^pick-[a-z0-9]{1,12}$/.test(def.id ?? "")) throw new Error("That isn't a picked object");
  const problem = selectorProblem(def.selector);
  if (problem) throw new Error(`Its address can't be used: ${problem}`);
  const several = Number.isInteger(def.several) && (def.several as number) > 1;
  if (!Array.isArray(def.path) || (!def.path.length && !several) || def.path.length > 24 || def.path.some((s) => !/^[a-z][\w:-]*$/i.test(s?.tag ?? "") || !Number.isInteger(s.nth) || !Number.isInteger(s.of) || s.nth < 1 || s.nth > s.of)) throw new Error("Its place on the page isn't given");
  return withWriteLock(async () => {
    const path = join(ROOT, "inspector.map.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as { parts?: MapEntry[]; tokens?: Record<string, unknown> } & Record<string, unknown>;
    const parts = (raw.parts ??= []);
    if (parts.some((p) => p.id === def.id)) return { id: def.id, tagged: tagTargetsOf(parts.find((p) => p.id === def.id) as MapEntry).length > 0 };
    const onPage = def.anchor === PAGE;
    const anchor = onPage ? null : parts.find((p) => p.id === def.anchor);
    if (!onPage && (!anchor || !tagTargetsOf(anchor).length)) throw new Error("The layer it sits in isn't one the code is tagged for");
    if (onPage ? !/^(body|#[A-Za-z][\w-]*) > /.test(def.selector) : !new RegExp(`^\\[${TAG}='${anchor?.id}'\\](:nth-of-type\\(\\d+\\))? > `).test(def.selector)) throw new Error(onPage ? "Its address doesn't start at the page" : "Its address doesn't start at that layer");
    const parent = parts.find((p) => p.id === def.listedIn) ?? anchor;

    // In the source, when it is a plain HTML file and the element is there for certain
    let tagged: { file: string; find: string } | null = null;
    let why = "";
    let scripted = false;
    const file = anchor ? tagTargetsOf(anchor).map((t) => t.file as string).find((f) => /\.html?$/i.test(f) && existsSync(join(ROOT, f))) : undefined;
    if (onPage) why = "it sits in no layer: kept by its place on the page";
    else if (several) why = `it is ${def.several} elements of one kind: kept as one layer by the address they share`;
    else if (!file) why = "its page isn't a plain HTML file";
    else {
      const html = readFileSync(join(ROOT, file), "utf8");
      const marks = [...html.matchAll(new RegExp(`\\s${TAG}=["']${anchor?.id}["']`, "g"))];
      // The layer's element in the file: its only one, or, of several (a row of cards written out), the one meant
      const which = def.which && Number.isInteger(def.which.nth) && def.which.of === marks.length ? marks[def.which.nth - 1] : marks.length === 1 && !def.which ? marks[0] : undefined;
      const el = which ? elementAt(html, html.lastIndexOf("<", which.index), def.path) : null;
      const sourceWords = el ? plainWords(el.text) : "";
      const pageWords = plainWords(def.words ?? "");
      const classes = el ? attrOf(el.open, "class").split(/\s+/).filter(Boolean) : [];
      const onPage = new Set((def.classes ?? "").split(/\s+/).filter(Boolean));
      const srcs = el ? [attrOf(el.open, "src"), attrOf(el.open, "data-src")].filter(Boolean).map(fileOf) : [];
      if (!which) why = marks.length ? "the layer it sits in isn't in the file as many times as on the page" : "the layer it sits in isn't tagged in this file";
      else if (!el) why = "the file's markup isn't laid out as the page is there (a script may build or move it)";
      else if (el.tag !== def.tag.toLowerCase() || !classes.every((c) => onPage.has(c))) why = "the element at that place in the file isn't the one on the page";
      else if (attrOf(el.open, TAG)) why = "the element at that place in the file is another layer already";
      else if (def.src && srcs.length && !srcs.includes(fileOf(def.src))) why = "the file at that place shows another picture than the page";
      else if (sourceWords && pageWords && !pageWords.startsWith(sourceWords.slice(0, 16)) && !sourceWords.startsWith(pageWords.slice(0, 16))) {
        scripted = true; // same element by tag, classes and place, other words: a script writes them
        why = "its words on the page aren't the words in the file: a script sets them";
      } else {
        await recordOutside();
        ownWrites.set(file, Date.now()); // the page carries the mark already: nothing to reload
        writeFileSync(safePath(file), `${html.slice(0, el.nameEnd)} ${TAG}="${def.id}"${html.slice(el.nameEnd)}`);
        tagged = { file, find: classes.length ? `class="${attrOf(el.open, "class")}"` : `<${el.tag}` };
      }
    }

    const label = String(def.label ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 60) || "Picked object";
    const known = new Set(Object.keys(raw.tokens ?? {}));
    const entry: MapEntry & { picked: boolean } = {
      id: def.id,
      label,
      group: parent?.group ?? "Site",
      ...(parent ? { parent: parent.id } : {}),
      ...(def.kind && KINDS.includes(def.kind) ? { kind: def.kind } : {}),
      prompt: [{ where: "Picked in the editor", text: plainWords(def.words ?? "").slice(0, 200) || label }],
      tokens: (def.tokens ?? []).filter((t) => typeof t === "string" && known.has(t)),
      files: parent?.files ?? anchor?.files ?? [],
      edit: parent?.edit ?? anchor?.edit ?? [],
      picked: true,
      targets: tagged ? [{ file: tagged.file, find: tagged.find }] : [{ selector: def.selector }],
    };
    // After the layer it is listed in and what that one already holds (the editor orders by the page either way)
    let at = parent ? parts.indexOf(parent) : parts.length - 1;
    for (let i = at + 1; parent && i < parts.length && parts[i].parent === parent.id; i++) at = i;
    parts.splice(at + 1, 0, entry);
    writeMap(raw);
    if (tagged) await record({ kind: "direct", partId: def.id, label: `Made a layer: ${label}`.slice(0, 100) });
    return { id: def.id, tagged: !!tagged, ...(tagged ? { file: tagged.file } : { why }), ...(scripted ? { scripted } : {}) };
  });
}
