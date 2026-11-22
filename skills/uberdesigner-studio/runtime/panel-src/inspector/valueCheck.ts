import { unsafeValue } from "../../server/values";

// Whether a value typed into a token's field can be saved, checked as it's typed. Two parts:
// - safe to write into the file: the same check the dev server makes before it writes (server/values.ts);
// - still the kind of value it replaces: here the browser itself answers (CSS.supports), which knows every colour
//   name and function. A colour field takes a colour, a time a time, an easing an easing, a size or number one of
//   those. A value built on var() can be anything, so then only the first part applies.
// The server checks again when saving: its answer is the one that counts.

const KINDS: [string, string[]][] = [
  ["a colour", ["color"]],
  ["a time", ["transition-delay"]],
  ["an easing", ["transition-timing-function"]],
  ["a size or a number", ["margin-left", "line-height", "font-size", "font-weight"]],
  ["a number", ["opacity"]],
];
const OPEN = /\b(var|env)\(|^(inherit|initial|unset|revert|revert-layer)$/i; // values whose kind can't be told

const supports = (property: string, value: string) => {
  try {
    return CSS.supports(property, value);
  } catch {
    return true; // no CSS.supports here: the server still checks
  }
};

// Why `value` can't be saved in place of `saved`, in plain words; null when it can
export function valueProblem(value: string, saved: string): string | null {
  const unsafe = unsafeValue(value);
  if (unsafe) return unsafe;
  const was = saved.trim();
  if (!was || OPEN.test(was)) return null;
  const kind = KINDS.find(([, properties]) => properties.some((p) => supports(p, was)));
  if (!kind || kind[1].some((p) => supports(p, value.trim()))) return null;
  return `it isn't ${kind[0]} (the value it replaces is one)`;
}
