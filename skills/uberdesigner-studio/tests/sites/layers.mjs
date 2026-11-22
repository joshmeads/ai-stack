// Every layer of a site: pick it from the list (the editor jumps to it), note whether it shows, what the footer says,
// whether a dashed "not shown" box appears, then click the middle of the element on the page and note what gets
// picked. Each jump is timed in the page, from the click until the editor has the layer in view. Plus the editor's and
// the site's frame rate, the "hidden" marks at load, and double-click text editing on up to four text layers.
// Read-only: nothing is saved.
import { layerSelector } from "./cdp.mjs";

export default async function layers(t, map) {
  const parts = map.parts.filter((p) => !p.removed && p.id !== "site");
  const byLabel = new Map(map.parts.map((p) => [p.label, p.id]));
  const out = { fps: null, siteFps: null, hiddenAtTop: [], layers: [], texts: [] };
  await t.sleep(9000); // intros
  const fps = (win) => `new Promise(r => { let n = 0; const t0 = ${win}.performance.now(); const f = () => { n++; ${win}.performance.now() - t0 < 3000 ? ${win}.requestAnimationFrame(f) : r(Math.round(n / 3)); }; ${win}.requestAnimationFrame(f); })`;
  out.fps = await t.ev(fps("window"));
  out.siteFps = await t.fev(fps("w"));
  out.hiddenAtTop = await t.ev(`[...document.querySelectorAll('button[data-layer]')].filter(b => /(hidden|not on page)$/.test(b.textContent.trim())).map(b => b.getAttribute('data-layer'))`);
  const visible = (id) =>
    t.fev(`(() => { for (const e of d.querySelectorAll('${layerSelector(id)}')) { const b = e.getBoundingClientRect(); if (e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && b.width >= 2 && b.height >= 2 && b.bottom > 0 && b.top < w.innerHeight && b.right > 0 && b.left < w.innerWidth) return [b.left + b.width / 2, b.top + b.height / 2]; } return null; })()`);
  for (const p of parts) {
    const r = { id: p.id };
    try {
      // The jump, timed in the page itself: from the click until the row's "mapping…" chip is gone (the editor shows
      // it for as long as it is bringing the layer into view), frame by frame. No fixed pauses are counted, so the
      // number is the editor's own time. A layer with nothing to jump to never shows the chip: about 0.15 s.
      const t0 = Date.now();
      const ms = await t.ev(`new Promise((done) => { const t0 = performance.now(); document.querySelector('button[data-layer="${p.id}"]')?.click(); let seen = false; const tick = () => { const on = !!document.querySelector('[data-seeking]'); seen = seen || on; const el = performance.now() - t0; if ((seen && !on) || (!seen && el > 150) || el > 25000) return done(Math.round(el)); requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`);
      // Versions from before the chip said "Looking for…" in the footer: wait that out too (not timed as finely)
      while (Date.now() - t0 < 25000 && /Looking for/.test(await t.status())) await t.sleep(300);
      r.jump = ms / 1000;
      await t.sleep(500); // the page at rest before it is read (not part of the jump)
      r.status = await t.status();
      r.ghost = await t.ev(`document.querySelector('div[data-state="ghost"]')?.textContent ?? null`);
      const at = await visible(p.id);
      r.shown = !!at;
      if (at && p.outline !== false) {
        // With nothing picked: this check is about the first click. Escape goes up one level at a time (in versions
        // before the click rule, one press drops the pick)
        for (let n = 0; n < 8; n++) {
          await t.key("Escape", "Escape", 27);
          await t.sleep(150);
          if (!(await t.ev(`!!document.querySelector('[data-active="true"]')`))) break;
        }
        const [x, y] = await t.toEditor(at[0], at[1]);
        await t.click(x, y);
        await t.sleep(400);
        // The picked layer by its heading; two layers with the same label can't be told apart this way. A click may
        // pick an object the map doesn't list (versions that pick one level in): then the layer it sits in is what
        // is compared, the last of the "layers it sits in" under the heading.
        const label = await t.ev(`(() => { const row = document.querySelector('[data-active="true"] button[data-layer]'); if (row && row.dataset.layer.startsWith('pick-')) { const up = [...document.querySelectorAll('nav[aria-label="Layers it sits in"] button')].pop(); if (up) return up.textContent.trim(); } return [...document.querySelectorAll('h2,h3')].map(h => h.textContent.trim())[0] ?? ''; })()`);
        r.pick = map.parts.filter((x) => x.label === label).length === 1 ? byLabel.get(label) : `label:${label}`;
      }
    } catch (err) {
      r.error = String(err.message).slice(0, 160);
    }
    out.layers.push(r);
  }
  for (const p of parts.filter((x) => x.kind === "text").slice(0, 4)) {
    await t.ev(`document.querySelector('button[data-layer="${p.id}"]')?.click()`);
    await t.sleep(2500);
    const at = await t.fev(`(() => { for (const e of d.querySelectorAll('${layerSelector(p.id)}')) { const b = e.getBoundingClientRect(); if (b.width >= 4 && b.bottom > 0 && b.top < w.innerHeight) return [b.left + Math.min(b.width / 2, 30), b.top + b.height / 2]; } return null; })()`);
    if (!at) {
      out.texts.push({ id: p.id, editing: "not on screen" });
      continue;
    }
    const [x, y] = await t.toEditor(at[0], at[1]);
    await t.dbl(x, y);
    await t.sleep(700);
    const editing = (await t.fev(`!!(d.activeElement && d.activeElement.isContentEditable)`)) || (await t.ev(`!!(document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable))`));
    out.texts.push({ id: p.id, editing });
    await t.key("Escape", "Escape", 27);
    await t.sleep(400);
  }
  return out;
}

// What differs between two runs, in plain lines
// moving: a piece that plays on a loop, where what shows depends on the moment each run caught: only errors, clicks on
// layers shown in both runs, and text editing are compared
export function compareLayers(a, b, { moving = false } = {}) {
  const lines = [];
  if (Math.abs((a.fps ?? 0) - (b.fps ?? 0)) > 10) lines.push(`editor fps ${a.fps} → ${b.fps}`);
  if (Math.abs((a.siteFps ?? 0) - (b.siteFps ?? 0)) > 10) lines.push(`site fps ${a.siteFps} → ${b.siteFps}`);
  const A = new Map(a.layers.map((r) => [r.id, r]));
  let jumpA = 0;
  let jumpB = 0;
  for (const r of b.layers) {
    const o = A.get(r.id) ?? {};
    jumpA += o.jump ?? 0;
    jumpB += r.jump ?? 0;
    if (o.error || r.error) lines.push(`${r.id}: error ${o.error ?? "-"} → ${r.error ?? "-"}`);
    if (!moving && !!o.shown !== !!r.shown) lines.push(`${r.id}: shown after the jump ${!!o.shown} → ${!!r.shown}`);
    if ((o.pick ?? null) !== (r.pick ?? null) && o.shown && r.shown) lines.push(`${r.id}: a click on it picks ${o.pick ?? "nothing"} → ${r.pick ?? "nothing"}`);
    if (!moving && !!o.ghost !== !!r.ghost) lines.push(`${r.id}: dashed box ${o.ghost ? `"${o.ghost.slice(0, 50)}"` : "none"} → ${r.ghost ? `"${r.ghost.slice(0, 50)}"` : "none"}`);
    if (!moving && (r.jump ?? 0) - (o.jump ?? 0) > 1.5) lines.push(`${r.id}: jump ${o.jump?.toFixed(1)} → ${r.jump?.toFixed(1)} s`);
  }
  const T = new Map(a.texts.map((x) => [x.id, x.editing]));
  for (const x of b.texts) if (T.has(x.id) && T.get(x.id) !== x.editing) lines.push(`${x.id}: text editing ${T.get(x.id)} → ${x.editing}`);
  const shownA = a.layers.filter((r) => r.shown).length;
  const shownB = b.layers.filter((r) => r.shown).length;
  // Jumps slower in all: by more than half, and by more than two seconds (machine noise stays under that)
  if (!moving && jumpB > jumpA * 1.5 && jumpB - jumpA > 2) lines.push(`jumps in all ${jumpA.toFixed(1)} → ${jumpB.toFixed(1)} s`);
  const median = (run) => {
    const all = run.layers.map((l) => l.jump ?? 0).sort((x, y) => x - y);
    return Math.round((all[Math.floor(all.length / 2)] ?? 0) * 1000);
  };
  return {
    summary: `${moving ? "(moving piece) " : ""}shown after the jump ${shownA} → ${shownB} of ${b.layers.length}, jumps ${jumpA.toFixed(1)} → ${jumpB.toFixed(1)} s in all (a typical one ${median(a)} → ${median(b)} ms), fps ${a.fps} → ${b.fps}`,
    lines,
  };
}
