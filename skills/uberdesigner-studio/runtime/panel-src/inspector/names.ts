// Words for a name. Pure text: nothing of the page or the map.

// A line that says one phrase over and over (a marquee) is named by the phrase
export function once(words: string): string {
  const w = words.split(" ");
  for (let p = 1; p * 2 <= w.length; p++) if (w.every((x, i) => x === w[i % p])) return w.slice(0, p).join(" ");
  return words;
}

// A file's name as a name for the thing, or "" when it is no name at all: a hash or an id a tool gave the file
// ("e5346ab8 e16d 4b8c bd18…") says nothing to a person
export function fileWords(name: string): string {
  const packed = name.replace(/[\s_-]+/g, "");
  return /^[0-9a-f]{12,}$/i.test(packed) || /\d{6,}/.test(packed) ? "" : name;
}
