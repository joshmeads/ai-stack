// The editor's shortcuts, read by the sign printed on the key whatever alphabet the keyboard is typing. On a Latin
// layout the sign typed is the sign meant (on Dvorak or AZERTY the key that types "i" is the "i" key, and a German
// "ü" is not a bracket). On any other (Russian, Greek, Hebrew…) the key types that alphabet's letter, so the key's
// place on the board is read instead, as the system's own shortcuts do: I opens the editor while typing "ш".

const PLACE: Record<string, string> = { i: "KeyI", "[": "BracketLeft", "]": "BracketRight" };

export function isKey(ev: { key: string; code: string }, sign: "i" | "[" | "]"): boolean {
  if (ev.key.toLowerCase() === sign) return true;
  return ev.key.length === 1 && !/[\p{Script=Latin}\x00-\x7f]/u.test(ev.key) && ev.code === PLACE[sign];
}
