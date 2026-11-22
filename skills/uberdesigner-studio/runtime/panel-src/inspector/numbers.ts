import { MAP } from "./parts";
import type { Thread } from "./jobs";

// A change's number: the same on its card and on its pin over the page. Numbers are handed out in the order the
// changes were asked for and never change afterwards: a card that is closed doesn't renumber the others, and a
// resolved card keeps its number. They are kept in the browser for the site (the editor and the site's own page
// share them); another browser hands them out again in the same order.

const KEY = `design-inspector:card-numbers:${MAP.name}`;
const KEEP = 400; // numbers remembered, newest kept
type Store = { next: number; ids: Record<string, number> };

function read(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Store | null;
    if (s && typeof s.next === "number" && s.ids && typeof s.ids === "object") return s;
  } catch {
    /* unreadable: start again */
  }
  return { next: 1, ids: {} };
}

let store = read();

export function numbersFor(threads: readonly Thread[]): Map<string, number> {
  const unseen = threads.filter((t) => !(t.id in store.ids));
  if (unseen.length) {
    store = read(); // another tab of the site may have numbered some of them already
    const fresh = unseen.filter((t) => !(t.id in store.ids)).sort((a, b) => (a.tries[0]?.queuedAt ?? 0) - (b.tries[0]?.queuedAt ?? 0));
    for (const t of fresh) store.ids[t.id] = store.next++;
    if (fresh.length) {
      const entries = Object.entries(store.ids);
      if (entries.length > KEEP) store.ids = Object.fromEntries(entries.sort((a, b) => a[1] - b[1]).slice(-KEEP));
      try {
        localStorage.setItem(KEY, JSON.stringify(store));
      } catch {
        /* private window: the numbers hold until the page is reloaded */
      }
    }
  }
  return new Map(threads.map((t) => [t.id, store.ids[t.id]]));
}
