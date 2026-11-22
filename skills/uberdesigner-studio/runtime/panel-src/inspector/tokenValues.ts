import type { CSSProperties } from "react";
import { ruleRe, ruleSelector } from "../../server/address";
// Reading and writing token values as they're written in tokens.css (not as the browser computes them), so a size
// stays "calc(127 * var(--u))" and the inspector can offer 127 as the number to change.

export type TokenSets = { desktop: Record<string, string>; mobile: Record<string, string> };

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// Every plain :root block applies in order (a later one, like a template's "look", overrides an earlier one), so
// "desktop" is all of them merged; :root blocks inside a media query are the phone overrides
export function readTokens(css: string): TokenSets {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  const desktop: Record<string, string> = {};
  const mobile: Record<string, string> = {};
  for (const m of clean.matchAll(/:root\s*\{([^}]*)\}/g)) {
    const before = clean.slice(0, m.index);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    Object.assign(depth > 0 ? mobile : desktop, declarations(m[1]));
  }
  return { desktop, mobile };
}

// Values set for one layer only, which the inspector saves as a rule after the :root blocks, under the layer's tag
// ([data-dm="…"]) or, for a layer found by a selector, under that selector (the element-level value wins over the
// site-wide one for that layer and what's inside it); inside a media query: phones
export function readPartTokens(css: string, parts: { id: string; targets?: unknown[] }[]): Record<string, TokenSets> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  const out: Record<string, TokenSets> = {};
  if (!clean.includes("{")) return out;
  for (const part of parts) {
    if (part.id === "site") continue;
    for (const m of clean.matchAll(ruleRe(ruleSelector(part)))) {
      const before = clean.slice(0, m.index);
      const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      const sets = (out[part.id] ??= { desktop: {}, mobile: {} });
      Object.assign(depth > 0 ? sets.mobile : sets.desktop, declarations(m[0].slice(m[0].indexOf("{") + 1, -1)));
    }
  }
  return out;
}

export const SIZE =/^calc\(\s*(-?[\d.]+)\s*\*\s*var\(--u\)\s*\)$/;
export const EM = /^(-?[\d.]+)em$/;
export const MS = /^([\d.]+)ms$/;

// --- Plain CSS values: the kinds of value Claude Code and hand-written sites use, each with the number a designer
// changes and how to write it back in the same form

// A length: 24px, 1.5rem, 0.8em, 60%, 4vw
export const LENGTH = /^(-?\d*\.?\d+)(px|rem|em|%|vw|vh|svh|dvh|vmin|vmax|ch)$/;
// A time: 300ms, 0.45s
export const TIME = /^(\d*\.?\d+)(ms|s)$/;
// N times one or more tokens: calc(20 * var(--fit) * var(--u)) or calc(4px * var(--u)); N is what changes
export const CALC_N = /^calc\(\s*(-?\d*\.?\d+)(px|rem)?\s*\*\s*(var\(--[\w-]+\)(?:\s*\*\s*var\(--[\w-]+\))*)\s*\)$/;
// Exactly another token: var(--ink)
export const ALIAS = /^var\(\s*(--[\w-]+)\s*\)$/;

// The arguments of clamp(a, b, c), split at its top-level commas
export function clampParts(v: string): string[] | null {
  const m = v.trim().match(/^clamp\((.*)\)$/);
  if (!m) return null;
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of m[1]) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts.length === 3 ? parts : null;
}

// Every number in a clamp() times f, keeping units and the rest: a clamp scaled as a whole
export const scaleNumbers = (v: string, f: number) =>
  v.replace(/(-?\d*\.?\d+)(px|rem|em|vw|vh|svh|dvh|%)/g, (_m, n: string, u: string) => `${+(+n * f).toFixed(3)}${u}`);

// A step that suits the unit
export const stepFor = (unit: string, n: number) => (unit === "px" || unit === "%" ? (Math.abs(n) < 4 ? 0.5 : 1) : unit === "s" ? 0.05 : unit === "ms" ? 10 : 0.05);

export type Rgba = { r: number; g: number; b: number; a: number };
// How a colour was written, so an edit keeps it: #rgb, #rrggbb, #rrggbbaa, rgb(r, g, b[, a]), rgb(r g b / a)
export type ColorSyntax = "hex" | "hex8" | "comma" | "space";

export function parseColor(v: string): Rgba | null {
  const t = v.trim();
  const hex = t.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : 1 };
  }
  const rgb = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: alpha(rgb[4]) };
  const space = t.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i);
  if (space) return { r: +space[1], g: +space[2], b: +space[3], a: alpha(space[4]) };
  return null;
}
const alpha = (a: string | undefined) => (a === undefined ? 1 : a.endsWith("%") ? +a.slice(0, -1) / 100 : +a);

export const colorSyntax = (v: string): ColorSyntax => {
  const t = v.trim();
  if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(t)) return "hex8";
  if (t.startsWith("#")) return "hex";
  return /^rgba?\([^,]*\s[\d.]+\s/.test(t) ? "space" : "comma";
};

export const toHex = ({ r, g, b }: Rgba) =>
  "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");

export function formatColor(c: Rgba, like: ColorSyntax = "hex"): string {
  const [r, g, b] = [c.r, c.g, c.b].map(Math.round);
  const a = +c.a.toFixed(2);
  if (like === "hex8") return toHex(c) + Math.round(c.a * 255).toString(16).padStart(2, "0");
  if (like === "space") return a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
  if (c.a >= 1) return like === "comma" ? `rgb(${r}, ${g}, ${b})` : toHex(c);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// A slider's filled part, up to its value: the track draws it from --fill (Inspector.module.css)
export const rangeFill = (n: number, min: number, max: number): CSSProperties =>
  ({ "--fill": `${max > min ? Math.min(100, Math.max(0, ((n - min) / (max - min)) * 100)) : 0}%` }) as CSSProperties;
