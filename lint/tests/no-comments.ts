export interface H {
  /** Doc on an interface member. */
  x: number;
}

/** Doc on a decorated export. */
@sealed
export class G {}

// @ts-expect-error the fixture checks a deliberate mismatch
const n: number = "x";

function sealed(_: unknown) {}
const cast = /** @type {number} @hit */ (1);
// a prose comment after a function @hit
type Local = {
  /** doc on a member of a type that is not exported @hit */
  y: string;
};

export type Shape = {
  /** Doc on a member of an exported type. */
  side: number;
};

function parse(text: string, kind: number) {
  try {
    return JSON.parse(text);
  } catch {
    // not JSON, fall back to the raw text
  }
  switch (kind) {
    case 1:
      text = text.trim();
      // falls through
    case 2:
      return text;
    default:
      return "";
  }
}
const noop = () => { /* nothing to do */ };
function busy() { /* prose beside code @hit */ return 1; }
// dprint-ignore
// deno-lint-ignore no-explicit-any
const heavy = import(/* turbopackIgnore: true */ "./heavy");
/* node:coverage ignore next */
// @refresh reset
// tslint:disable-next-line:no-any
// eslint-disable-next-line no-console
/* webpackChunkName: "x" */
