// Which attribute changes on a layer are not a state the page switched (presence.ts records the rest, so Play can
// switch them off and on again): the inspector's own tags, styling and geometry (style, an SVG shape's d, x, y, width,
// height, transform), addresses, form values, and what assistive technology reads. Each is a whole name, or a prefix
// that says so: a bare "d" used to match every attribute that starts with d, data-ready and data-visible among them,
// so the states a page switched were never recorded. No imports, so it is tested on its own.

const EXACT = new Set(["style", "tabindex", "src", "srcset", "href", "d", "transform", "x", "y", "width", "height", "value", "checked", "data-dm"]);
const PREFIX = ["aria-", "data-design-inspector", "data-inspector"];

export const notAState = (attribute: string) => EXACT.has(attribute) || PREFIX.some((p) => attribute.startsWith(p));
