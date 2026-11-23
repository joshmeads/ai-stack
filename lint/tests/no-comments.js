#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/* eslint-disable no-console */
// eslint-disable-next-line no-undef
// prose comment @hit
/** Doc on export. */
export function a() {}

// prose before export @hit
export function b() {}

/** Doc then directive. */
// oxlint-disable-next-line no-console
export function c() { console.log(1) }

/** Doc on a private function @hit */
function d() {}

export class E {
  /** Doc on a member of an exported class. */
  method() {
    /** doc inside a method body @hit */
    const x = 1;
    return x;
  }
}

export function f() {
  // inside an exported function @hit
  return 1;
}

// WARNING: deleting this breaks the release script
const g = 1;
// WARNING: the next line is prose
//   continued prose @hit
/* block prose @hit */
const h = /* inline prose @hit */ 2;
// istanbul ignore next
// c8 ignore next
/// <reference types="node" />
export default { a, b, c, d, f, g, h };
// @flow strict
switch (g) {
  case 1:
    // fall through
  default:
    // no default
}
if (h) {
  // an empty branch a linter asks to explain
} else {
  h; // prose beside code @hit
}
// $FlowFixMe[incompatible-call]
h(); // NOSONAR
