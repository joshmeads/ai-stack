import { api } from "./api";
import { useEffect, useState } from "react";
import { MAP } from "./parts";

// The site's words, when it keeps them in a JSON file the map names (content.file): fetched from the dev server,
// edited in the panel, written back by Save (the dev server then reloads the page, so the change shows). Sites
// without a words file show no word fields; their words change through Claude like anything else.

export type Words = Record<string, string | string[]>;

export type WordsState = {
  has: boolean; // the site has a words file
  saved: Words; // as on disk
  words: Words; // with the panel's edits
  set: (key: string, value: string | string[]) => void;
  reset: () => void;
};

export function useWords(version: number): WordsState {
  const [saved, setSaved] = useState<Words>({});
  const [words, setWordsState] = useState<Words>({});
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!MAP.content) return;
    api("/__inspector/words")
      .then((r) => r.json() as Promise<{ file: string | null; words: Words }>)
      .then((d) => {
        setHas(!!d.file);
        setSaved(d.words);
        setWordsState(d.words);
      })
      .catch(() => setHas(false));
  }, [version]);
  return {
    has,
    saved,
    words,
    set: (key, value) => setWordsState((w) => ({ ...w, [key]: value })),
    reset: () => setWordsState(saved),
  };
}

export const wordLabel = (key: string) =>
  MAP.content?.labels?.[key] ?? key.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
