import { useEffect, useRef, useState } from "react";
import e from "./Editor.module.css";
import styles from "./Inspector.module.css";
import { coverDue } from "./narrow";
import { useShield } from "./shield";

// Over the editor when it is open in the Claude app's own browser and that pane is too narrow for it (narrow.ts says
// when): the editor blurred behind, and one card that says to open the same address in a real browser, with a button
// that copies it. "Continue here anyway" (or Escape) takes the cover away for this tab; widening the pane takes it
// away by itself.
const STAYED = "design-inspector:narrow-ok"; // this tab was told once

function stayedBefore(): boolean {
  try {
    return window.sessionStorage.getItem(STAYED) === "1";
  } catch {
    return false; // no storage here: ask again after a reload
  }
}

export function NarrowCover() {
  const [width, setWidth] = useState(() => window.innerWidth);
  const [stayed, setStayed] = useState(stayedBefore);
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const box = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLElement>(null);

  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const stay = () => {
    setStayed(true);
    try {
      window.sessionStorage.setItem(STAYED, "1");
    } catch {
      /* no storage: the cover is gone until a reload */
    }
  };

  const due = !stayed && coverDue(navigator.userAgent, width);
  useShield(box, due, stay);
  if (!due) return null;

  const address = window.location.href;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("yes");
      setTimeout(() => setCopied(""), 2200);
    } catch {
      // No clipboard here: select the address, so one ⌘C copies it
      const el = link.current;
      if (el) window.getSelection()?.selectAllChildren(el);
      setCopied("no");
    }
  };

  return (
    <div className={e.narrowBack}>
      <div ref={box} className={`${e.confirm} ${e.narrow}`} role="dialog" aria-modal="true" aria-labelledby="design-inspector-narrow">
        <h2 id="design-inspector-narrow">The studio needs a wider window</h2>
        <p>
          Copy the link and open it in <strong>your browser</strong>.
        </p>
        <code ref={link} className={e.narrowLink}>
          {address}
        </code>
        <p className={e.narrowNote}>
          {copied === "no" ? "Couldn't reach the clipboard. The link is selected: copy it with ⌘C." : "A localhost link works there too: it is this computer."}
        </p>
        <button type="button" className={styles.primary} autoFocus onClick={() => void copy()}>
          {copied === "yes" ? "Link copied" : "Copy link"}
        </button>
        <button type="button" className={e.narrowStay} onClick={stay}>
          Continue here anyway
        </button>
      </div>
    </div>
  );
}
