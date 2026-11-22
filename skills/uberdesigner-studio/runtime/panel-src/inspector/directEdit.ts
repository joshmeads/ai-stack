// What the panel says after an edit the inspector tries to write itself, with no Claude call: words typed over the
// page, a link, an image, a slider, a motion timing.
//
// Written: one quiet line in the footer with Undo beside it. No card: an edit that simply worked is not a change to
// review (it is a version in History like any other).
// Not written (the inspector can't be sure where it lives in the files): nothing is sent anywhere. The line says why,
// and a button asks Claude for it, with what that would cost. Only then is there a card.
import { api } from "./api";
import { markOwnAction } from "./jobs";

export type Offer = { label: string; run: () => void };
export type Say = (text: string | null, offer?: Offer) => void;
export type DirectOut = { ok: boolean; error?: string; direct?: boolean; why?: string; tokens?: number; entry?: string; saved?: string };

const cost = (tokens?: number) => (tokens ? ` (about ${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens)` : "");

// done: what to say when it was written ("Text saved"); askClaude: sends the same edit again for Claude to make;
// after: runs once anything changed in the files (the editor refreshes what it shows)
export function tellDirect(out: DirectOut, done: string, say: Say, askClaude: () => void, after: () => void) {
  if (!out.ok) throw new Error(out.error ?? "That couldn't be changed");
  if (out.direct) {
    const entry = out.entry;
    say(
      done,
      entry
        ? {
            label: "Undo",
            run: () => {
              markOwnAction(); // the page reloads by itself if taking it back needs that
              void api("/__inspector/undo-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry }) })
                .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
                .then((r) => say(r.ok ? "Taken back" : (r.error ?? "It couldn't be taken back")))
                .catch(() => say("It couldn't be taken back"))
                .finally(after);
            },
          }
        : undefined,
    );
    after();
    return;
  }
  say(`Not changed: ${out.why ?? "the studio can't be sure where this lives in the files"}.`, { label: `Ask Claude${cost(out.tokens)}`, run: askClaude });
}
