import { useEffect, useMemo, useRef, useState } from "react";
import { ensureFont, firstFamily, fontValue, useFonts, type FontFamily } from "./fonts";
import styles from "./Inspector.module.css";

// A font token as a picker: the current family, and a searchable list of Google Fonts by kind. Hovering a name shows it
// in its own face; picking one sets the token (and loads the family into the site; Save adds it to the page's <head>).

const KINDS = ["All", "Sans Serif", "Serif", "Display", "Handwriting", "Monospace"];
const SHOWN = 60; // names drawn at once; searching narrows the rest

export function FontControl({ value, onPick }: { value: string; onPick: (f: FontFamily, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All");
  const fonts = useFonts(open);
  const box = useRef<HTMLDivElement>(null);
  const current = firstFamily(value);

  // Closes on a click elsewhere
  useEffect(() => {
    if (!open) return;
    const away = (ev: PointerEvent) => {
      if (!box.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fonts.filter((f) => (kind === "All" || f.category === kind) && (!q || f.family.toLowerCase().includes(q))).slice(0, SHOWN);
  }, [fonts, query, kind]);

  return (
    <div className={styles.font} ref={box}>
      <button type="button" className={styles.fontButton} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{current || "Pick a font"}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className={styles.fontPop}>
          <input autoFocus placeholder="Search Google Fonts" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search fonts" />
          <div className={styles.fontKinds}>
            {KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "Sans Serif" ? "Sans" : k === "Handwriting" ? "Script" : k === "Monospace" ? "Mono" : k}
              </button>
            ))}
          </div>
          <ul className={styles.fontList}>
            {!fonts.length && <li className={styles.fontEmpty}>Loading the list…</li>}
            {fonts.length > 0 && !shown.length && <li className={styles.fontEmpty}>No family by that name</li>}
            {shown.map((f) => (
              <li key={f.family}>
                <button
                  type="button"
                  data-current={f.family === current}
                  onPointerEnter={() => ensureFont(document, f)}
                  onClick={() => {
                    onPick(f, fontValue(f));
                    setOpen(false);
                  }}
                  style={{ fontFamily: `"${f.family}", ${f.category === "Serif" ? "serif" : "sans-serif"}` }}
                >
                  {f.family}
                  <small>{f.category}</small>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.fontSource}>Google Fonts · more libraries later</p>
        </div>
      )}
    </div>
  );
}
