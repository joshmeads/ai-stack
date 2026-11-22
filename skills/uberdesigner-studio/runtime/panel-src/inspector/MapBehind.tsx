import { api } from "./api";
import { useEffect, useState } from "react";
import styles from "./Inspector.module.css";

// Has the map fallen behind the site? The dev server checks for free (GET /__inspector/map-check): files the map names
// that are gone, parts whose tag left the code, new page files no part covers, a build prompt edited after the map.
// The panel says so at the top of the parts list, until the map is updated.

export type MapCheck = {
  behind: boolean;
  missingFiles: { file: string; parts: string[] }[];
  untagged: { id: string; label: string }[];
  newFiles: string[];
  promptChanged: boolean;
  absent?: string[]; // parts the inspector's own changes removed (or added) whose tag isn't in the code now
};

const ASK = "Update the uberdesigner studio map for this site: the studio says the map is behind the code.";
const SHOWN = 3; // names listed per line before "+N more"

// Checked when the panel loads, whenever a change finishes (it may add a file), whenever one is taken back or a version
// is restored (the layers it added are gone from the code again), and when the window gets focus back (the code may
// have changed in an editor or another Claude chat). `when` is anything that changes at those moments.
export function useMapCheck(when: string | number): MapCheck | null {
  const [check, setCheck] = useState<MapCheck | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const d = (await (await api("/__inspector/map-check")).json()) as { ok: boolean; check: MapCheck | null };
        if (alive && d.ok) setCheck(d.check);
      } catch {
        /* the dev server is restarting; the next focus or change asks again */
      }
    };
    void run();
    window.addEventListener("focus", run);
    return () => {
      alive = false;
      window.removeEventListener("focus", run);
    };
  }, [when]);
  return check;
}

const list = (names: string[]) => (names.length > SHOWN ? `${names.slice(0, SHOWN).join(", ")} +${names.length - SHOWN} more` : names.join(", "));

export function MapBehind({ check }: { check: MapCheck | null }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  if (!check?.behind) return null;

  const lines = [
    check.untagged.length > 0 && `No longer tagged in the code: ${list(check.untagged.map((p) => p.label))}`,
    check.missingFiles.length > 0 && `Files gone: ${list(check.missingFiles.map((f) => f.file))}`,
    check.newFiles.length > 0 && `New files no part covers: ${list(check.newFiles)}`,
    check.promptChanged && "The build prompt changed after the map was made",
  ].filter((l): l is string => !!l);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ASK);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* no clipboard (an insecure page): the request is on screen to type */
    }
  };

  return (
    <div className={styles.behind} role="status">
      <button type="button" className={styles.behindHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={styles.behindDot} aria-hidden="true" />
        <strong>The map is behind the site</strong>
        <span className={styles.behindMore}>{open ? "Less" : "Why"}</span>
      </button>
      {open && (
        <ul>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p>
        New or changed parts can't be picked until it's updated. Ask Claude Code to <q>update the uberdesigner studio map</q>; it
        keeps your parts and history.
      </p>
      <button type="button" className={styles.behindCopy} onClick={copy}>
        {copied ? "Copied" : "Copy the request"}
      </button>
    </div>
  );
}
