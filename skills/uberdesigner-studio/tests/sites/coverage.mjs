// How much of what a visitor sees can be picked. At a dozen places down the page, up to four things on screen are
// taken (blocks of words, pictures, videos, drawings: chosen by what they are on the page, not by the map or by the
// editor's own rule), and each is clicked in its middle, then once more: does the editor's selection land on that
// thing's own box? "One click": it is a layer of the map. "Two": the editor picked inside a layer (a ⌘-click, or in
// versions that did it that way a second click). "Not reached": the click picked something bigger, or nothing.
// Read-only: nothing is kept or saved.
const PLACES = 12;
const PER_PLACE = 4;

export default async function coverage(t) {
  await t.sleep(9000); // intros
  const span = await t.fev(`Math.max(0, d.documentElement.scrollHeight - w.innerHeight)`);
  const out = { things: [] };
  const selected = () =>
    t.ev(`(() => { const frame = document.querySelector('iframe'); if (!frame) return []; const r = frame.getBoundingClientRect(); const k = r.width / frame.contentWindow.innerWidth; return [...document.querySelectorAll('[data-state="selected"]')].map((f) => { const b = f.getBoundingClientRect(); return [(b.left - r.left) / k, (b.top - r.top) / k, b.width / k, b.height / k]; }); })()`);
  // The same box, near enough: the share of the two boxes' joint area that both cover
  const same = (boxes, b) => (boxes ?? []).some((a) => sameBox(a, b));
  const sameBox = (a, b) => {
    if (!a || !b) return false;
    const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (w <= 0 || h <= 0) return false;
    return (w * h) / (a[2] * a[3] + b[2] * b[3] - w * h) >= 0.8;
  };
  for (let i = 0; i < PLACES; i++) {
    const y = Math.round((span * i) / Math.max(1, PLACES - 1));
    await t.fev(`w.scrollTo(0, ${y})`);
    await t.sleep(1100);
    // Things on screen, top to bottom: whole in the viewport, visible, not the size of the screen, and what a click
    // at their middle would land on (not under something else)
    const things = await t.fev(`(() => {
      const seen = (e) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      const ownWords = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      const list = [];
      for (const e of d.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li, figcaption, img, video, svg, canvas')) {
        const tag = e.localName;
        const words = !['img', 'video', 'svg', 'canvas'].includes(tag);
        if (words && !ownWords(e)) continue;
        if (e.ownerSVGElement) continue;
        const b = e.getBoundingClientRect();
        if (b.width < 12 || b.height < 12 || b.top < 4 || b.left < 0 || b.bottom > w.innerHeight - 4 || b.right > w.innerWidth) continue;
        if (b.width * b.height > w.innerWidth * w.innerHeight * 0.6 || !seen(e)) continue;
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const top = d.elementFromPoint(cx, cy);
        if (top && !(e.contains(top) || top.contains(e)) && w.getComputedStyle(e).pointerEvents !== 'none') continue;
        list.push({ what: tag, words: (e.getAttribute('alt') || e.textContent || e.getAttribute('class') || '').replace(/\\s+/g, ' ').trim().slice(0, 40), box: [b.left, b.top, b.width, b.height].map(Math.round), x: Math.round(cx), y: Math.round(cy) });
      }
      list.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
      const step = Math.max(1, Math.floor(list.length / ${PER_PLACE}));
      return list.filter((_, k) => k % step === 0).slice(0, ${PER_PLACE});
    })()`);
    for (const thing of things) {
      await t.key("Escape", "Escape", 27);
      await t.sleep(250);
      const [x, y2] = await t.toEditor(thing.x, thing.y);
      let reach = "not reached";
      await t.click(x, y2);
      await t.sleep(650);
      if (same(await selected(), thing.box)) reach = "one click";
      else {
        // Not a layer of the map: with ⌘ held (versions that pick inside a layer that way), else by clicking again
        for (const modifiers of [4, 0]) {
          await t.key("Escape", "Escape", 27);
          await t.sleep(200);
          for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await t.send("Input.dispatchMouseEvent", { type, x, y: y2, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, modifiers });
          await t.sleep(650);
          if (!modifiers) {
            await t.click(x, y2);
            await t.sleep(650);
          }
          if (same(await selected(), thing.box)) {
            reach = "two clicks";
            break;
          }
        }
      }
      out.things.push({ at: y, what: thing.what, words: thing.words, reach, picked: reach === "not reached" ? await t.ev(`[...document.querySelectorAll('h2,h3')].map(h => h.textContent.trim())[0] ?? ''`) : undefined });
    }
  }
  await t.key("Escape", "Escape", 27);
  return out;
}

const count = (run, reach) => run.things.filter((x) => x.reach === reach).length;
export function compareCoverage(a, b) {
  const lines = b.things.filter((x) => x.reach === "not reached").slice(0, 8).map((x) => `not reached: ${x.what} "${x.words}" at ${x.at} px (the click picks ${x.picked || "nothing"})`);
  const say = (run) => `${count(run, "one click") + count(run, "two clicks")} of ${run.things.length} (${count(run, "one click")} as layers, ${count(run, "two clicks")} inside one)`;
  const better = count(b, "one click") + count(b, "two clicks") - (count(a, "one click") + count(a, "two clicks"));
  return { summary: `things on screen that can be picked: ${say(a)} → ${say(b)}`, lines: better === 0 && a.things.length === b.things.length ? [] : lines.length ? lines : [`${better >= 0 ? "+" : ""}${better} reached`] };
}
