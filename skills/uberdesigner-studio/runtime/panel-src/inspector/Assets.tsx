import { useEffect, useMemo, useState } from "react";
import { partById } from "./parts";
import { layerAround, layerIdOf } from "./resolve";
import styles from "./Inspector.module.css";

// Assets: the pictures and videos the open page shows, one row per file, in page order. Read from the page itself,
// so it lists what is really there at this size: <img>, <video> (and its poster), SVG <image>, CSS backgrounds, and
// files the site's code loaded without putting them on the page (a texture for a canvas or WebGL scene), last.
// A click on a row picks the thing that shows it, as a click on the page would: its layer's values, and Replace…
// for a picture or video, are in Elements. A file only the code uses can't be picked.

type Asset = { url: string; path: string; name: string; video: boolean; els: Element[] };

const IMAGE = /\.(png|jpe?g|webp|avif|gif|svg|bmp|ico)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i;
const MAX_ELEMENTS = 6000; // elements whose backgrounds are read, at most: a page bigger than that lists its first ones
const AGAIN_MS = [1500, 5000]; // read again after a load: lazy pictures and code-loaded textures come in late

const urlsIn = (value: string) => [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]);

function readAssets(doc: Document): Asset[] {
  const win = doc.defaultView;
  if (!win || !doc.body) return [];
  const byUrl = new Map<string, Asset>();
  const add = (raw: string | null | undefined, el: Element | null, video: boolean) => {
    if (!raw || /^(data|blob|about|javascript):/i.test(raw.trim())) return;
    let url: URL;
    try {
      url = new URL(raw, doc.baseURI);
    } catch {
      return;
    }
    if (url.origin === win.location.origin && url.pathname.startsWith("/__inspector")) return;
    const key = url.href;
    let a = byUrl.get(key);
    if (!a) {
      const path = url.origin === win.location.origin ? decodeURIComponent(url.pathname) : url.href;
      a = { url: key, path, name: decodeURIComponent(url.pathname.split("/").pop() || url.hostname), video, els: [] };
      byUrl.set(key, a);
    }
    if (el && !a.els.includes(el)) a.els.push(el);
  };

  for (const img of doc.querySelectorAll("img")) add(img.currentSrc || img.getAttribute("src"), img, false);
  for (const v of doc.querySelectorAll("video")) {
    add(v.currentSrc || v.getAttribute("src") || v.querySelector("source")?.getAttribute("src"), v, true);
    add(v.getAttribute("poster"), v, false);
  }
  for (const i of doc.querySelectorAll("image")) add(i.getAttribute("href") ?? i.getAttribute("xlink:href"), i, false);
  const all = doc.body.getElementsByTagName("*");
  for (let i = 0; i < all.length && i < MAX_ELEMENTS; i++) {
    const bg = win.getComputedStyle(all[i]).backgroundImage;
    if (bg && bg !== "none" && bg.includes("url(")) for (const u of urlsIn(bg)) add(u, all[i], false);
  }
  // Loaded by the code: only files that look like pictures or videos (fonts, scripts and data are not assets here)
  for (const r of win.performance.getEntriesByType("resource")) {
    let path: string;
    try {
      path = new URL(r.name).pathname;
    } catch {
      continue;
    }
    if (IMAGE.test(path)) add(r.name, null, false);
    else if (VIDEO.test(path)) add(r.name, null, true);
  }
  // Page order by the first element that shows each; code-only files after them
  const placed = [...byUrl.values()].filter((a) => a.els.length);
  placed.sort((a, b) => (a.els[0].compareDocumentPosition(b.els[0]) & 4 ? -1 : 1));
  return [...placed, ...[...byUrl.values()].filter((a) => !a.els.length)];
}

// The layer a row's first element sits in, by its name
const whereOf = (a: Asset) => {
  if (!a.els.length) return "Used by the site's code";
  const part = partById(layerIdOf(layerAround(a.els[0])));
  const more = a.els.length > 1 ? ` · ${a.els.length} places` : "";
  return `${part?.label ?? "On the page"}${more}`;
};

type Props = { doc: Document | null; version: number; loads: number; selectedEls: readonly Element[]; onPick: (el: Element) => void };

export function Assets({ doc, version, loads, selectedEls, onPick }: Props) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [query, setQuery] = useState("");
  const [again, setAgain] = useState(0);

  useEffect(() => {
    if (!doc) return;
    setAssets(readAssets(doc));
    const win = doc.defaultView;
    const timers = AGAIN_MS.map((ms) => win?.setTimeout(() => setAssets(readAssets(doc)), ms));
    return () => timers.forEach((t) => t !== undefined && win?.clearTimeout(t));
  }, [doc, version, loads, again]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (assets ?? []).filter((a) => !q || a.path.toLowerCase().includes(q) || whereOf(a).toLowerCase().includes(q));
  }, [assets, query]);

  if (!doc || !assets) return <p className={styles.empty}>Loading the page…</p>;

  return (
    <section className={styles.assets}>
      <input
        type="search"
        className={styles.assetSearch}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find an asset…"
        aria-label="Find an asset"
        spellCheck={false}
      />
      <p className={styles.phone}>
        {assets.length} {assets.length === 1 ? "picture or video" : "pictures and videos"} on this page.{" "}
        <button type="button" className={styles.link} onClick={() => setAgain((n) => n + 1)}>
          Read again
        </button>
      </p>
      {shown.length === 0 ? (
        <p className={styles.empty}>{assets.length ? "Nothing matches." : "This page shows no pictures or videos."}</p>
      ) : (
        <ul>
          {shown.map((a) => {
            const pickable = a.els.length > 0;
            const picked = a.els.some((el) => selectedEls.includes(el));
            return (
              <li key={a.url}>
                <button
                  type="button"
                  className={styles.asset}
                  data-picked={picked}
                  disabled={!pickable}
                  title={pickable ? `${a.path}\nPick it on the page` : `${a.path}\nThe site's code loads it (a canvas or WebGL scene, say): it isn't on the page to pick`}
                  onClick={() => pickable && onPick(a.els[0])}
                >
                  {a.video ? <video src={a.url} muted preload="metadata" /> : <img src={a.url} alt="" loading="lazy" />}
                  <span>
                    <strong>{a.name}</strong>
                    <small>{whereOf(a)}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
