import type { TokenKind } from "./parts";

// A plain name for a design token, so the editor says "Body, buttons, table text · text size" rather than --fs-body.
// The map can give one ("label", written by the skill); otherwise it's made from the prompt's own words in the
// token's role ("Typography › Body, buttons, table text: 18 (phones 16)") and what the code name says it controls.

type Meta = { kind: TokenKind; role: string; label?: string };

// Sections that only say what kind of value it is; any other section ("Pill", "Frame") names the thing itself
const GENERIC_SECTIONS = /^(colou?rs?|typography|type|fonts?|easing|motion|timing|spacing|sizes?|layout|tokens?|values?|other)$/i;

// What a code name's pieces mean, for names the prompt doesn't explain
const WORDS: Record<string, string> = {
  fs: "text size",
  lh: "line spacing",
  pitch: "line spacing",
  ls: "letter spacing",
  track: "letter spacing",
  tracking: "letter spacing",
  fw: "weight",
  ff: "font",
  px: "side padding",
  py: "top and bottom padding",
  pad: "padding",
  gap: "gap",
  r: "corner radius",
  radius: "corner radius",
  w: "width",
  h: "height",
  edge: "page edge",
  u: "unit",
  bg: "background",
  fg: "text colour",
  ink: "ink",
  dur: "duration",
  ms: "duration",
  delay: "delay",
  ease: "easing",
  z: "layer order",
  op: "opacity",
  alpha: "opacity",
  btn: "button",
  nav: "navigation",
  reg: "registered mark",
  lp: "LP tag",
  rule: "divider line",
};

const PROPERTY = new Set(["text size", "line spacing", "letter spacing", "weight", "font", "side padding", "top and bottom padding", "padding", "gap", "corner radius", "width", "height", "duration", "delay", "easing", "opacity"]);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The prompt's words, minus values the control already shows ("Body (hero copy), 18" -> "Body (hero copy)") and with
// typesetting jargon in plain words
const VALUE = /[,\s]+[−-]?\d[\d.]*\s*(px|em|rem|ms|s|%)?(\s*\(.*\))?$/i;
function plain(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 3 && VALUE.test(s); i++) s = s.replace(VALUE, "").trim();
  return s
    .replace(/\bline pitch\b|\bpitch\b|\bleading\b|\bline height\b/gi, "line spacing")
    .replace(/\btracking\b/gi, "letter spacing")
    .replace(/,\s*$/, "")
    .trim();
}

// "--fs-body" -> "Body text size"; "--clock-grey" -> "Clock grey"
function fromCodeName(name: string, kind: TokenKind): string {
  const words = name.replace(/^--/, "").split(/[-_]/).filter(Boolean).map((w) => WORDS[w] ?? w);
  const props = words.filter((w) => PROPERTY.has(w));
  const things = words.filter((w) => !PROPERTY.has(w));
  if (kind === "color" && things.at(-1) === "text") things[things.length - 1] = "text colour";
  return cap([...things, ...props].join(" ").trim() || name);
}

// The property a code name points at, when the prompt's words don't already say it
function propertyOf(name: string): string | null {
  for (const w of name.replace(/^--/, "").split(/[-_]/)) {
    const p = WORDS[w];
    if (p && PROPERTY.has(p)) return p;
  }
  return null;
}

// What a font token is for, from the prompt's "(display)" or the code name ("--display", "--font-body")
const FONT_ROLES: Record<string, string> = {
  display: "Headline",
  heading: "Headline",
  headline: "Headline",
  title: "Headline",
  text: "Body",
  body: "Body",
  copy: "Body",
  sans: "Body",
  mono: "Code",
  code: "Code",
  serif: "Serif",
  accent: "Accent",
};
const FONT_SECTION = /^(typography|type|fonts?)$/i;

// A typeface token: a Typography entry whose code name points at no property ("--display: 'Mona Sans'")
function fontRole(name: string, meta: Meta): string | null {
  const section = meta.role.split("›")[0].trim();
  if (meta.kind !== "text" || !FONT_SECTION.test(section) || propertyOf(name)) return null;
  const hints = [...(meta.role.match(/\(([^)]+)\)/)?.[1].split(/[\s,/]+/) ?? []), ...name.replace(/^--/, "").split(/[-_]/)];
  const hit = hints.map((w) => w.toLowerCase()).find((w) => FONT_ROLES[w]);
  return hit ? FONT_ROLES[hit] : "";
}

// Prompt sentences are notes, not names: keep what comes before the first comma or bracket of a long one
function shorten(subject: string): string {
  if (subject.length <= 32) return subject;
  const cut = subject.split(/\s*[,(;—–]\s*/)[0].trim();
  return cut.length >= 3 ? cut : subject;
}

export function tokenLabel(name: string, meta: Meta | undefined): string {
  if (meta?.label) return meta.label;
  if (!meta?.role) return fromCodeName(name, meta?.kind ?? "text");
  const font = fontRole(name, meta);
  if (font !== null) return font ? `${font} font` : "Font";
  const [section, ...rest] = meta.role.split("›").map((s) => s.trim());
  const body = rest.join(" › ") || section;
  const colon = body.indexOf(":");
  let subject = (colon > 0 ? body.slice(0, colon) : body).trim();
  const bare = name.replace(/^--/, "");
  // The prompt just repeats the code name ("black: page background", "--ease: cubic-bezier(…)")
  if (!subject || subject.replace(/^--/, "").toLowerCase() === bare.toLowerCase() || subject.length > 48) return fromCodeName(name, meta.kind);
  subject = shorten(plain(subject));
  if (rest.length && !GENERIC_SECTIONS.test(section) && !subject.toLowerCase().includes(section.toLowerCase())) subject = `${section} ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
  const property = propertyOf(name);
  // Already said when the name ends in the same kind of word ("Pill vertical padding" is a padding)
  const said = property && subject.toLowerCase().includes(property.split(" ").at(-1) ?? property);
  return cap(property && !said && meta.kind !== "color" ? `${subject} · ${property}` : subject);
}

// The prompt's description without the part the label already says ("page background", "18 (phones 16)")
// For a font, the prompt's line itself ("Mona Sans, always SemiCondensed"), since the label only says what it's for.
export function tokenNote(meta: Meta | undefined, name = ""): string {
  if (!meta?.role) return "";
  const body = meta.role.split("›").slice(1).join("›").trim() || meta.role;
  if (!meta.label && fontRole(name, meta) !== null) return body.replace(/\s*\([^)]*\)/g, "").trim();
  const colon = body.indexOf(":");
  return colon > 0 ? body.slice(colon + 1).trim() : "";
}
