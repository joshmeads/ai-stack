// Which attribute changes count as a state the page switched (runtime/panel-src/inspector/switches.ts)
import assert from "node:assert/strict";
import { test } from "node:test";
import { notAState } from "../../runtime/panel-src/inspector/switches.ts";

test("states a page switches are recorded, whatever they're called", () => {
  for (const name of ["data-ready", "data-visible", "data-waiting", "data-state", "hidden", "open"]) assert.equal(notAState(name), false, name);
});

test("styling, geometry, addresses, form values and the inspector's own tags are not states", () => {
  for (const name of ["style", "d", "x", "y", "width", "height", "transform", "src", "srcset", "href", "value", "checked", "tabindex", "aria-hidden", "aria-expanded", "data-dm", "data-inspector-font", "data-design-inspector-replay"]) assert.equal(notAState(name), true, name);
});

test("a name that only starts like one of those is its own attribute", () => {
  for (const name of ["data-dmx", "xlink-thing", "yes", "values", "heightened", "srcdoc"]) assert.equal(notAState(name), false, name);
});
