import { api } from "./api";
import { useEffect, useState } from "react";

// Fonts the picker offers. Google Fonts is the first library: the dev server fetches its public list (no key) and keeps
// it for a week (server/direct.ts). Another library would be one more source here, with its own stylesheet address.

export type FontFamily = { family: string; category: string; popularity: number; weights: number[]; wght: [number, number] | null; italic: boolean };

let list: FontFamily[] | null = null;
let loading: Promise<FontFamily[]> | null = null;

export function loadFonts(): Promise<FontFamily[]> {
  if (list) return Promise.resolve(list);
  loading ??= api("/__inspector/fonts")
    .then((r) => r.json() as Promise<{ ok: boolean; fonts: FontFamily[] }>)
    .then((d) => (list = d.ok ? d.fonts : []))
    .catch(() => (loading = null, []));
  return loading;
}

export function useFonts(open: boolean): FontFamily[] {
  const [fonts, setFonts] = useState<FontFamily[]>(list ?? []);
  useEffect(() => {
    if (open && !list) void loadFonts().then(setFonts);
  }, [open]);
  return fonts;
}

export const findFont = (family: string) => list?.find((f) => f.family === family) ?? null;

// The stylesheet that loads a family with every weight it has (the dev server writes the same one into the page)
export function fontHref(f: FontFamily): string {
  const name = f.family.trim().replace(/ /g, "+");
  const axis = f.wght ? `:wght@${f.wght[0]}..${f.wght[1]}` : f.weights.length > 1 ? `:wght@${f.weights.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${name}${axis}&display=swap`;
}

// Load a family into a document (the site's frame, or the editor for the picker's previews), once
export function ensureFont(doc: Document | null | undefined, f: FontFamily) {
  if (!doc) return;
  const id = `design-inspector-font-${f.family.replace(/\W+/g, "-")}`;
  if (doc.getElementById(id)) return;
  const link = doc.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = fontHref(f);
  doc.head.appendChild(link);
}

const FALLBACK: Record<string, string> = { "Sans Serif": "sans-serif", Serif: "serif", Monospace: "monospace", Handwriting: "cursive", Display: "sans-serif" };
// The CSS value for a family: its name, then the generic family of its kind
export const fontValue = (f: FontFamily) => `"${f.family}", ${FALLBACK[f.category] ?? "sans-serif"}`;
// The first family named in a font value ("Mona Sans", sans-serif -> Mona Sans)
export const firstFamily = (value: string) => value.split(",")[0].trim().replace(/^["']|["']$/g, "");
// A value that names a typeface: a quoted family, or a list ending in a generic family
export const isFontValue = (value: string) => /^\s*["']/.test(value) || /,\s*(sans-serif|serif|monospace|cursive|system-ui)\s*$/.test(value);
