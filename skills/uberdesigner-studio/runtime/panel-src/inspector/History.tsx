import { api } from "./api";
import { useEffect, useState } from "react";
import styles from "./Inspector.module.css";
import { markOwnAction } from "./jobs";

// History is the way back to the whole site as it was. It lists points, newest first: every save, where each work
// session started, the moment before a whole-site change and before going back, and one every ten versions when
// nothing else came up. Underneath, every single write is a version (that is what lets one change be taken back on
// its own); "Every step" shows them all, and an edit the inspector wrote itself can be taken back from there.
// Going back adds a new version, so it can itself be taken back.

type Entry = {
  id: string;
  time: string;
  kind: "start" | "change" | "save" | "restore" | "undo" | "redo" | "outside" | "direct" | "pick";
  label: string;
  point?: string; // why this version is a point to go back to
  undone?: boolean; // a change that is not in the page now
  mode?: "part" | "project";
  request?: string;
  summary?: string;
  usage?: { input: number; output: number; costUsd: number };
  files: string[];
};

const KIND: Record<Entry["kind"], string> = {
  start: "start",
  change: "Claude",
  direct: "edit",
  pick: "pick",
  save: "saved",
  restore: "back",
  undo: "undo",
  redo: "redo",
  outside: "outside",
};

// "14:20" today, "12 Nov, 14:20" before
function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}
// A row's words: a request can run to a paragraph with markup in it, a row has room for a line
const short = (text: string) => {
  const line = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return line.length > 64 ? `${line.slice(0, 63)}…` : line;
};

type Props = { version: number; onRestored: () => void };

export function History({ version, onRestored }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState(false);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    api("/__inspector/history")
      .then((r) => r.json() as Promise<{ entries: Entry[] }>)
      .then((d) => setEntries(d.entries))
      .catch(() => setError("Can't reach the dev server"));
  }, [version, again]);

  const send = async (id: string, url: string, body: object, fallback: string) => {
    setBusy(id);
    setError(null);
    try {
      markOwnAction();
      const out = (await (await api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()) as { ok: boolean; error?: string };
      if (!out.ok) throw new Error(out.error);
      setAgain((n) => n + 1);
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  };
  const restore = (id: string) => send(id, "/__inspector/restore", { id }, "Couldn't go back");
  const undoEdit = (id: string) => send(id, "/__inspector/undo-edit", { entry: id }, "Couldn't take it back");

  if (!entries) return <p className={styles.empty}>{error ?? "Loading history…"}</p>;

  const spent = entries.reduce((n, e) => n + (e.usage ? e.usage.input + e.usage.output : 0), 0);
  // The newest version is the site as it is now; under it, the points, or every step
  const listed = entries.filter((e, i) => i === 0 || steps || e.point);
  // How many versions lie between a point and the one listed above it
  const since = (e: Entry) => {
    const at = entries.indexOf(e);
    const above = listed[listed.indexOf(e) - 1];
    return above ? at - entries.indexOf(above) - 1 : 0;
  };

  return (
    <section className={styles.history}>
      <p className={styles.phone}>
        {steps ? `${entries.length} versions` : `${listed.length - 1} ${listed.length === 2 ? "point" : "points"} to go back to`} · {spent.toLocaleString()} tokens spent on changes. Going back adds a
        new version, so you can always come back.{" "}
        <button type="button" className={styles.link} aria-pressed={steps} onClick={() => setSteps((s) => !s)}>
          {steps ? "Points only" : `Every step (${entries.length})`}
        </button>
      </p>
      {error && <p className={styles.error}>{error}</p>}
      <ol>
        {listed.map((e, i) => (
          <li key={e.id} className={styles.version} data-current={i === 0} data-point={!!e.point}>
            <button type="button" className={styles.versionHead} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className={styles.badge} data-kind={e.kind}>
                {!steps && e.point && i > 0 ? "point" : KIND[e.kind]}
              </span>
              <span className={styles.versionLabel} data-undone={!!e.undone}>
                {!steps && i > 0 && e.point && e.kind !== "save" && e.kind !== "start" ? e.point : short(e.label)}
                {e.undone ? " (not in the page now)" : ""}
              </span>
              <time>{when(e.time)}</time>
            </button>
            {open === e.id && (
              <div className={styles.versionBody}>
                {e.point && <p>{steps || e.kind === "save" || e.kind === "start" ? e.point : short(e.label)}</p>}
                {!steps && since(e) > 0 && <p className={styles.phone}>{since(e)} more {since(e) === 1 ? "version" : "versions"} between this and the one above.</p>}
                {e.summary && <p>{e.summary}</p>}
                {e.files.length > 0 && <p className={styles.phone}>{e.files.join(", ")}</p>}
                {e.usage && (
                  <p className={styles.phone}>
                    {e.mode === "project" ? "Whole project" : "This part"} · {e.usage.input.toLocaleString()} in / {e.usage.output.toLocaleString()} out
                  </p>
                )}
              </div>
            )}
            {i === 0 ? (
              <span className={styles.now}>now</span>
            ) : (
              <span className={styles.versionActions}>
                {steps && e.kind === "direct" && !e.undone && (
                  <button type="button" className={styles.ghost} disabled={!!busy} title="Take back this one edit; everything made since stays" onClick={() => void undoEdit(e.id)}>
                    {busy === e.id ? "…" : "Undo"}
                  </button>
                )}
                <button type="button" className={styles.ghost} disabled={!!busy} title="Put the whole site back as it was here" onClick={() => void restore(e.id)}>
                  {busy === e.id ? "Going back…" : "Go back here"}
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
