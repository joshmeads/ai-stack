import { api } from "./api";
import { useEffect, useRef, useState } from "react";
import { isMotionParam, paramKey, type Param, type Part } from "./parts";
import { startChange, type Settings } from "./change";
import type { Jobs } from "./jobs";
import { rangeFill } from "./tokenValues";
import { MotionFound } from "./MotionFound";
import { elementOf, ownedBy } from "./resolve";
import { tellDirect, type DirectOut, type Say } from "./directEdit";
import styles from "./Inspector.module.css";

// What a picked layer offers besides its tokens, read from its element on the page: the address a button or link goes
// to, the picture or video it shows (replaced with one from the computer), the settings of an effect the map lists,
// and Delete. Each is written straight into the site's files when the inspector is sure where it lives: quietly, with
// Undo beside the footer's line and a version in History. When it isn't sure, nothing is sent: the footer says why
// and offers to ask Claude (directEdit.ts).

type Direct = DirectOut;

async function post(url: string, body: BodyInit, json = true): Promise<Direct> {
  const res = await api(url, { method: "POST", headers: json ? { "Content-Type": "application/json" } : { "Content-Type": "application/octet-stream" }, body });
  return (await res.json()) as Direct;
}

type Props = {
  part: Part;
  doc: Document | null;
  seen: string; // the parts on screen: changes as the site draws, so the element is read again
  version: number;
  settings: Settings;
  jobs: Jobs;
  blocked: string | null;
  onStatus: Say;
  onDone: () => void;
  onPlay: () => void;
};

export function LayerExtras({ part, doc, seen, version, settings, blocked, onStatus, onDone, onPlay }: Props) {
  const [link, setLink] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  // src: as the page's code has it (what a replacement swaps); shown: its full address, for the thumbnail here (the
  // editor's own address is /__inspector/…, so "hero.svg" would be looked for there)
  const [media, setMedia] = useState<{ src: string; shown: string; video: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // The element's link and media, as the page has them now
  useEffect(() => {
    const el = elementOf(doc, part.id);
    // Only its own: a link or picture inside a nested layer belongs to that layer (Hero's photo is Hero photo's)
    const own = (sel: string) => (el ? Array.from(el.querySelectorAll(sel)).filter((x) => ownedBy(el, x)) : []);
    const links = own("a[href]");
    const a = el?.matches("a[href]") ? el : links.length === 1 ? links[0] : null;
    const href = a?.getAttribute("href") ?? null;
    setLink(href);
    setLinkDraft(href ?? "");
    const m = el?.matches("img, video") ? el : own("img, video")[0];
    const src = m?.getAttribute("src") ?? m?.querySelector("source")?.getAttribute("src") ?? null;
    let shown = src ?? "";
    try {
      if (src && doc) shown = new URL(src, doc.baseURI).href;
    } catch {
      /* an address the browser can't read: shown as written */
    }
    setMedia(src ? { src, shown, video: m?.tagName === "VIDEO" } : null);
  }, [part.id, doc, seen, version]);

  // again: the same edit sent once more for Claude to make, when the person asks for that
  const finish = (out: Direct, what: string, again: () => void, asked: boolean) => {
    if (!out.ok) throw new Error(out.error ?? `The ${what} couldn't be changed`);
    if (asked && !out.direct) {
      onStatus(`Sent to Claude: ${out.why ?? "it couldn't be done directly"}`);
      return onDone();
    }
    tellDirect(out, `${what} changed in the file`, onStatus, again, onDone);
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    if (blocked) return onStatus(blocked);
    onStatus(`Changing the ${what.toLowerCase()}…`);
    try {
      await fn();
    } catch (err) {
      onStatus(err instanceof Error ? err.message : `The ${what.toLowerCase()} couldn't be changed`);
    }
  };

  const saveLink = (claude = false): void =>
    void (link !== null && linkDraft.trim() && linkDraft.trim() !== link
      ? run("Link", async () =>
          finish(await post("/__inspector/link", JSON.stringify({ partId: part.id, from: link, to: linkDraft.trim(), model: settings.model, effort: "low", claude })), "Link", () => saveLink(true), claude),
        )
      : undefined);

  const replace = (f: File, claude = false): void =>
    void run("Image", async () => {
      const q = new URLSearchParams({ part: part.id, name: f.name, from: media?.src ?? "", model: settings.model, effort: "low", ...(claude ? { claude: "1" } : {}) });
      finish(await post(`/__inspector/media?${q}`, f, false), media?.video ? "Video" : "Image", () => replace(f, true), claude);
    });

  return (
    <>
      {link !== null && (
        <>
          <h3>Link</h3>
          <div className={styles.linkRow}>
            <input
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveLink()}
              spellCheck={false}
              aria-label={`${part.label} link`}
              placeholder="https://… or #section"
            />
            <button type="button" className={styles.ghost} onClick={() => void saveLink()} disabled={!linkDraft.trim() || linkDraft.trim() === link}>
              Set
            </button>
          </div>
        </>
      )}

      {media && (
        <>
          <h3>{media.video ? "Video" : "Image"}</h3>
          <div className={styles.media}>
            {media.video ? <video src={media.shown} muted /> : <img src={media.shown} alt="" />}
            <div>
              <button type="button" className={styles.ghost} onClick={() => file.current?.click()}>
                Replace…
              </button>
              <small title={media.src}>{media.src}</small>
            </div>
          </div>
          <input
            ref={file}
            type="file"
            accept={media.video ? "video/mp4,video/webm,video/quicktime" : "image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml"}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void replace(f);
            }}
          />
        </>
      )}

      {(part.params ?? []).some((p) => !isMotionParam(p)) && <Effect part={part} version={version} settings={settings} blocked={blocked} onStatus={onStatus} onDone={onDone} onPlay={onPlay} motion={false} />}
      {(part.params ?? []).some(isMotionParam) && <Effect part={part} version={version} settings={settings} blocked={blocked} onStatus={onStatus} onDone={onDone} onPlay={onPlay} motion />}
      <MotionFound part={part} doc={doc} seen={seen} version={version} settings={settings} blocked={blocked} onStatus={onStatus} onDone={onDone} onPlay={onPlay} />
    </>
  );
}

// Delete: Claude removes the layer from the code; Undo on its card (or History) brings it back
export function DeleteLayer({ part, settings, jobs, blocked, onStatus }: Pick<Props, "part" | "settings" | "jobs" | "blocked" | "onStatus">) {
  const remove = async () => {
    if (blocked) return onStatus(blocked);
    try {
      await startChange({
        part,
        request: `Delete ${part.label} from the page: remove its element and everything inside it, and the styles and code only it uses. Leave the rest of the layout as it is. List its id (and the ids of the parts inside it) in "map.remove".`,
        continuing: null,
        settings,
        manual: null,
        jobs,
      });
      onStatus(`Deleting ${part.label}: Undo on its card brings it back`);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Couldn't start the delete");
    }
  };
  return (
    <button type="button" className={`${styles.ghost} ${styles.danger} ${styles.deleteLayer}`} onClick={() => void remove()} title="Claude removes it from the code; Undo on the card brings it back">
      Delete layer
    </button>
  );
}

// ▶ Play, beside anything that sets motion: shows the layer's animation again on the page
export function PlayButton({ onPlay, label = "Play" }: { onPlay: () => void; label?: string }) {
  return (
    <button type="button" className={styles.play} onClick={onPlay} title="Play the animation on the page, with the values you're editing">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 3.5v9l7.5-4.5z" />
      </svg>
      {label}
    </button>
  );
}

// A setting the dev server flagged: its number changed by a change it didn't make itself, or it lost its place
type SettingFlag = { was: number | null; now: number | null; by: string; at: string };

// An effect's settings: numbers in its code. A slider shows the value as you drag; letting go writes it into the file
// (the page updates as the code reloads), as one card with Undo.
// motion: the settings that are timings (listed under "Animation timing"), else the effect's other numbers
function Effect({ part, version, settings, blocked, onStatus, onDone, onPlay, motion }: Omit<Props, "doc" | "seen" | "jobs"> & { motion: boolean }) {
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [flags, setFlags] = useState<Record<string, SettingFlag>>({});
  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    api(`/__inspector/params?part=${encodeURIComponent(part.id)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; values: Record<string, number | null>; flags?: Record<string, SettingFlag> }>)
      .then((d) => alive && d.ok && (setValues(d.values), setFlags(d.flags ?? {}), setDraft({})))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [part.id, version]);

  const settingOk = async (key: string) => {
    setFlags((f) => (key === "*" ? {} : Object.fromEntries(Object.entries(f).filter(([k]) => k !== key))));
    await post("/__inspector/setting-ok", JSON.stringify({ partId: part.id, key })).catch(() => undefined);
  };

  const commit = async (p: Param, asked?: number) => {
    const key = paramKey(p);
    const value = asked ?? draft[key];
    if (value === undefined || (asked === undefined && value === values[key])) return;
    if (blocked) return onStatus(blocked);
    onStatus(`Setting ${p.label}…`);
    try {
      const out = await post("/__inspector/param", JSON.stringify({ partId: part.id, name: key, value, model: settings.model, effort: "low", claude: asked !== undefined }));
      if (!out.ok) throw new Error(out.error ?? "Couldn't set it");
      if (asked !== undefined && !out.direct) {
        onStatus(`Sent to Claude: ${out.why ?? "it couldn't be done directly"}`);
        return onDone();
      }
      // Not written: the slider goes back to the number the file has
      if (!out.direct) setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)));
      tellDirect(out, `${p.label} set in the file`, onStatus, () => void commit(p, value), onDone);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Couldn't set it");
    }
  };

  return (
    <>
      <h3 className={styles.withPlay}>
        {motion ? "Animation timing" : "Effect"} <PlayButton onPlay={onPlay} />
      </h3>
      {(() => {
        // One line for the layer when settings were moved: who did it, how many, and one button to accept them all
        const mine = (part.params ?? []).filter((p) => isMotionParam(p) === motion && flags[paramKey(p)]);
        if (!mine.length) return null;
        const by = flags[paramKey(mine[0])].by;
        return (
          <p className={styles.phone}>
            {mine.length === 1 ? "1 setting" : `${mine.length} settings`} changed by “{by.slice(0, 70)}”. Each shows the number it points at now; check the ones that matter.{" "}
            <button type="button" className={styles.link} onClick={() => void settingOk("*")}>
              All right
            </button>
          </p>
        );
      })()}
      {(part.params ?? []).filter((p) => isMotionParam(p) === motion).map((p) => {
        const key = paramKey(p);
        const saved = values[key];
        const flag = flags[key];
        if (saved === undefined) return null;
        // Lost: the text before its number isn't in the file once any more (the code around it changed)
        if (saved === null)
          return (
            <div key={key} className={styles.token}>
              <div className={styles.tokenHead}>
                <strong className={styles.tokenName}>{p.label}</strong>
              </div>
              <p className={styles.phone}>
                Lost its place in the code{flag?.by && flag.by !== "the map" ? ` after “${flag.by.slice(0, 60)}”` : ""}: the number after <code>{(p.find ?? p.name ?? "").slice(0, 40)}</code> isn't in {p.file} once any more. Ask Claude to “fix the {p.label} setting”.
              </p>
            </div>
          );
        const n = draft[key] ?? saved;
        const span = Math.abs(saved) || 1;
        const min = p.min ?? (saved < 0 ? saved * 3 : 0);
        const max = p.max ?? span * 3;
        const step = p.step ?? (max - min) / 200;
        const set = (x: number) => setDraft((d) => ({ ...d, [key]: x }));
        return (
          <div key={key} className={styles.token} data-changed={draft[key] !== undefined && draft[key] !== saved}>
            <div className={styles.tokenHead}>
              <strong className={styles.tokenName}>{p.label}</strong>
              {flag && (
                <button type="button" className={styles.link} onClick={() => void settingOk(key)} title="The number this setting points at is the right one">
                  it's right
                </button>
              )}
            </div>
            {flag && (
              <p className={styles.phone}>
                Was {flag.was ?? "?"}, now {flag.now}: check it's still the {p.label.toLowerCase()}.
              </p>
            )}
            <div className={styles.number}>
              <input type="range" min={min} max={max} step={step} value={n} style={rangeFill(n, min, max)} onChange={(e) => set(+e.target.value)} onPointerUp={() => void commit(p)} onKeyUp={() => void commit(p)} />
              <input type="number" step={step} value={+n.toFixed(4)} onChange={(e) => set(+e.target.value)} onBlur={() => void commit(p)} onKeyDown={(e) => e.key === "Enter" && void commit(p)} />
              {p.unit && <span>{p.unit}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
