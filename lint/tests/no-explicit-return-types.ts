export function a(): number { return 1; } // @hit
function b(x: unknown): x is string { return typeof x === "string"; }
const c = (): string => "c"; // @hit
function d(): never { throw new Error("d"); }
declare function e(): number;
class K {
  m(): void {} // @hit
}
function f() { return 1; }
