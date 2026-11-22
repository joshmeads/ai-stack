// The one check every CSS value passes before the inspector writes it into a file. A value arrives as text typed in
// the panel (or sent to the API), and goes into a declaration the inspector writes: `--ink: <value>;`. Two questions:
//
// 1. Is it safe to write? It must stay inside its declaration: brackets and quotes closed, nothing that ends the
//    declaration, the rule or (in an HTML page) the <style> block. `rgb(0,0` would swallow the CSS after it.
// 2. Does it keep its kind? A token that holds a colour takes a colour. `notacolor` or `#12345` is valid text for a
//    custom property, so nothing would complain, and everything using the token would silently lose its colour.
//
// Plain text work with no imports, so the panel uses the same file for the field's own check (and adds the browser's
// exact answer, CSS.supports, on top: panel-src/inspector/valueCheck.ts). The server's answer is the one that counts.

const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral " +
    "cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange " +
    "darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey " +
    "dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred " +
    "indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
    "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon " +
    "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue " +
    "mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred " +
    "papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna " +
    "silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
    "yellowgreen transparent currentcolor"
  ).split(" "),
);
// Words every property takes
const WIDE = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
const COLOR_FUNCTIONS = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|var|env)\(/i;

// Why a piece of CSS text doesn't close what it opens (a bracket, a quote, a trailing backslash), or null. Shared with
// the check of a layer's selector address (address.ts).
export function unclosed(v: string): string | null {
  const open: string[] = [];
  const pair: Record<string, string> = { ")": "(", "]": "[" };
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "\\") {
      if (i === v.length - 1) return "it ends with a backslash";
      i++;
    } else if (c === '"' || c === "'") {
      const end = (() => {
        for (let j = i + 1; j < v.length; j++) {
          if (v[j] === "\\") j++;
          else if (v[j] === c) return j;
        }
        return -1;
      })();
      if (end < 0) return `a quote (${c}) isn't closed`;
      i = end;
    } else if (c === "(" || c === "[") open.push(c);
    else if (c === ")" || c === "]") {
      if (open.pop() !== pair[c]) return `there's a "${c}" with nothing to close`;
    }
  }
  if (open.length) return `a "${open[open.length - 1]}" isn't closed`;
  return null;
}

// Why a value can't be written into a declaration, in plain words; null when it can
export function unsafeValue(value: string): string | null {
  const v = value.trim();
  if (!v) return "it's empty";
  if (/[\r\n]/.test(v)) return "it has a line break";
  // Also inside quotes: the code that later rewrites a declaration (css-write.ts setDeclaration) reads a value up to the
  // next ";" or "}", quotes or not
  const bad = v.match(/[;{}<>]|\/\*|\*\//);
  if (bad) return `it has "${bad[0]}", which would end the value early`;
  return unclosed(v);
}

// Whether a value is written as a colour: a hex of 3, 4, 6 or 8 digits, a colour function, a named colour. A var()
// counts: what it points at is the other token's business.
export function colorShaped(value: string): boolean {
  const v = value.trim().replace(/\s*!important$/i, "");
  if (/^#[0-9a-f]+$/i.test(v)) return [3, 4, 6, 8].includes(v.length - 1);
  if (COLOR_FUNCTIONS.test(v)) return v.endsWith(")") && unsafeValue(v) === null;
  return NAMED_COLORS.has(v.toLowerCase()) || WIDE.has(v.toLowerCase());
}

// A value that is a colour beyond doubt (not a var(), which may hold anything): what decides that a token is a colour
// token from the value it has now
export const isColorValue = (value: string) => colorShaped(value) && !/^(var|env)\(/i.test(value.trim()) && !WIDE.has(value.trim().toLowerCase());

// Why `value` can't replace `current` (the token's value now), or null when it can. Safe to write, and a colour stays
// a colour. Other kinds (sizes, times, numbers) are judged by the panel, which can ask the browser; here they only
// need to be safe.
export function valueProblem(value: string, current?: string | null): string | null {
  const unsafe = unsafeValue(value);
  if (unsafe) return unsafe;
  if (current && isColorValue(current) && !colorShaped(value)) return "it isn't a colour (the value it replaces is one)";
  return null;
}

// Whether a stylesheet's braces pair up, comments and quoted text left out. A write that leaves them unpaired has
// swallowed the rules after it.
export function bracesBalance(css: string): boolean {
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return false;
      i = end + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
  }
  return depth === 0;
}
