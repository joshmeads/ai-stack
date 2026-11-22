// Picking, as a person meets it, against the V1 goal (files/design-map-notes/V1-GOAL.md, section 1) and the click
// rule settled on 17 Nov 2026:
//   1. reach        every visual object on screen is reached by a click, then up to two double-clicks at the same
//                   point (a double-click goes inside; on words it picks that text and types), or by one click on its
//                   row in the list (found the way a person would: click the block on the page, open its row, look
//                   under it);
//   2. predictable  the box shown under the pointer is what the click picks, the pick holds the point clicked, and the
//                   same click picks the same thing after a reload;
//   3. no phantoms  every outline (at rest, and under the pointer as it moves) sits on something that can be seen;
//                   hovering a big block outlines it; a section that is full on screen is not empty in the list;
//   4. light        the editor stays smooth with the processor slowed four times (a weak computer), and the
//                   inspector's own share of the work is small;
//   5. stays        the selection is still on its thing after the page reloads, at another device size, and after
//                   the editor itself reloads.
// It runs the same on any version of the inspector (an older one has no "inside": its double-click only types), so
// two versions can be compared. ⌘-click is noted for information; the rule doesn't need it.
// What is "on screen" is decided here from the page alone (tags, paint, size), never from the map or from the editor's
// own rule for objects, so the check can't agree with the editor by construction.
// Read-only: nothing is kept or saved. About three minutes a site.
//   node tests/sites/picking.mjs <editor url> [name] [--json out.json]     a site whose server is already running
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLACES = 8; // when the list has no sections to go by
const MOST = 16; // places at most
const ROWS = 60; // rows of the list looked at for one thing
const BLOCKS = 3; // per place
const PIECES = 3;
const INSIDE = 2; // double-clicks after the first click
const SLOW = 4; // processor slowdown for the weak computer

// --- what the page shows at the place it is scrolled to (runs in the site's frame; w, d are its window and document)
const ON_SCREEN = (tops) => `(() => {
  const TOPS = ${JSON.stringify(tops)};
  const VW = w.innerWidth, VH = w.innerHeight, AREA = VW * VH;
  // Seen: not hidden, and not faded to a tenth or less through itself and what it sits in (nobody points at that)
  const seen = (e) => { if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false; let o = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) o *= Number(w.getComputedStyle(a).opacity); return o > 0.1; };
  // The box of what can be seen of it: cut by whatever crops it (a portrait bigger than its round holder shows as
  // big as the holder)
  const box = (e) => { const r = e.getBoundingClientRect(); let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom; for (let p = e.parentElement, n = 0; p && p !== d.body && n < 20; p = p.parentElement, n++) { const s = w.getComputedStyle(p); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue; const c = p.getBoundingClientRect(); x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom); } return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)].map(Math.round); };
  const whole = (b) => b[2] >= 12 && b[3] >= 12 && b[1] >= 4 && b[0] >= 0 && b[1] + b[3] <= VH - 4 && b[0] + b[2] <= VW;
  // On top where it is: of nine points inside it, how many land on it, on something inside it, or on something around it
  const onTop = (e, b) => { let n = 0; for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) { const t = d.elementFromPoint(b[0] + b[2] * fx, b[1] + b[3] * fy); if (t && (e.contains(t) || t.contains(e))) n++; } return n; };
  // What the pointer passes through (a decoration with pointer-events: none) can't be asked this way: it counts as seen
  const top = (e, b) => w.getComputedStyle(e).pointerEvents === 'none' || onTop(e, b) >= 7;
  const words = (e) => (e.getAttribute('alt') || e.getAttribute('aria-label') || e.textContent || e.getAttribute('class') || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const paints = (e) => { const s = w.getComputedStyle(e); const bg = s.backgroundColor; return (bg && !/rgba\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*0\\s*\\)|transparent/.test(bg)) || s.backgroundImage !== 'none' || (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') || s.boxShadow !== 'none'; };
  const layerOf = (e) => { for (let a = e; a && a.nodeType === 1; a = a.parentElement) if (a.hasAttribute('data-dm')) return a; return null; };
  const sameBox = (a, b) => { const iw = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return iw > 0 && ih > 0 && (iw * ih) / (a[2] * a[3] + b[2] * b[3] - iw * ih) >= 0.8; };
  // A layer of its own: it, or something of the same box around or inside it, carries the inspector's mark
  const isLayer = (e, b) => { for (let a = e; a && a.nodeType === 1; a = a.parentElement) { if (!sameBox(box(a), b)) break; if (a.hasAttribute('data-dm')) return a.getAttribute('data-dm'); } for (const c of e.querySelectorAll('[data-dm]')) if (sameBox(box(c), b)) return c.getAttribute('data-dm'); return null; };
  // Each thing's element is marked, so it is followed where it goes (a marquee, floating bubbles) and compared by
  // where it is at that moment
  w.__pkn = w.__pkn ?? 0;
  const item = (e, b, what) => { const mark = String(++w.__pkn); e.setAttribute('data-pk-thing', mark); return { mark, what, words: words(e), box: b, x: Math.round(b[0] + b[2] / 2), y: Math.round(b[1] + b[3] / 2), layer: isLayer(e, b), around: layerOf(e)?.getAttribute('data-dm') ?? null }; };
  // Blocks: something with a face of its own (a fill, a border, a shadow, or a picture), 1.5% to 60% of the screen
  const blocks = [];
  for (const e of d.body.querySelectorAll('*')) {
    if (e.ownerSVGElement || ['html', 'body', 'script', 'style'].includes(e.localName)) continue;
    const media = ['img', 'video', 'canvas', 'svg', 'picture'].includes(e.localName);
    const b = box(e);
    if (!whole(b) || b[2] * b[3] < AREA * 0.015 || b[2] * b[3] > AREA * 0.6) continue;
    if (!media && !paints(e)) continue;
    if (!seen(e) || !top(e, b)) continue;
    if (blocks.some((k) => sameBox(k.box, b))) continue; // a wrapper of the same size is the same block
    blocks.push(item(e, b, media ? e.localName : 'block'));
  }
  // Pieces: blocks of words and small pictures, as a reader would point at them
  const pieces = [];
  for (const e of d.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li, figcaption, a, button, img, video, svg')) {
    const media = ['img', 'video', 'svg'].includes(e.localName);
    if (e.ownerSVGElement) continue;
    if (!media && ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const b = box(e);
    if (!whole(b) || b[2] * b[3] >= AREA * 0.015) continue;
    if (!seen(e) || !top(e, b)) continue;
    if (pieces.some((k) => sameBox(k.box, b))) continue;
    pieces.push(item(e, b, media ? e.localName : 'words'));
  }
  const spread = (list, n) => { list.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]); const step = Math.max(1, Math.floor(list.length / n)); return list.filter((_, k) => k % step === 0).slice(0, n); };
  const holds = {};
  for (const k of [...blocks, ...pieces]) { let a = d.elementFromPoint(k.x, k.y); const tops = new Set(TOPS); let id = null; for (let e2 = a; e2 && e2.nodeType === 1; e2 = e2.parentElement) if (e2.hasAttribute('data-dm') && tops.has(e2.getAttribute('data-dm'))) id = e2.getAttribute('data-dm'); if (id) holds[id] = (holds[id] ?? 0) + 1; }
  return { blocks: spread(blocks, ${BLOCKS}), pieces: spread(pieces, ${PIECES}), allBlocks: blocks.length, mappedBlocks: blocks.filter((k) => k.layer).length, holds };
})()`;

// An outline with nothing to see under it: the element it is drawn on is as good as transparent, or something that
// isn't part of it lies over it. Given the outline boxes the editor draws (site coordinates), answered on the page: the
// element is the layer, or whatever is at the box's middle, with that box.
const PHANTOMS = (boxes) => `(() => {
  const boxes = ${JSON.stringify(boxes)};
  const VW = w.innerWidth, VH = w.innerHeight;
  // An element's box, the part of it inside the screen (the editor outlines what is on screen of a tall section)
  const rect = (e) => { const b = e.getBoundingClientRect(); const x0 = Math.max(0, b.left), y0 = Math.max(0, b.top); return [x0, y0, Math.max(0, Math.min(VW, b.right) - x0), Math.max(0, Math.min(VH, b.bottom) - y0)]; };
  const sameBox = (a, b) => { const iw = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return iw > 0 && ih > 0 && (iw * ih) / (a[2] * a[3] + b[2] * b[3] - iw * ih) >= 0.85; };
  const layers = [...d.querySelectorAll('[data-dm]')];
  const out = [];
  for (const b of boxes) {
    if (b[2] < 8 || b[3] < 8 || b[0] + b[2] <= 0 || b[1] + b[3] <= 0 || b[0] >= VW || b[1] >= VH) continue; // off screen: not seen
    const there = [];
    for (const h of d.elementsFromPoint(Math.min(VW - 1, Math.max(0, b[0] + b[2] / 2)), Math.min(VH - 1, Math.max(0, b[1] + b[3] / 2)))) for (let a = h; a && a.nodeType === 1 && a !== d.body; a = a.parentElement) there.push(a);
    // Every element with that box: the outline may be on any of them (a section and a full-screen canvas in it), so
    // it is over nothing only when none of them can be seen
    const all = [...new Set([...layers, ...there])].filter((k) => sameBox(rect(k), b));
    if (!all.length) continue; // a group's joint box, a clipped one, or one the page moved since: not judged
    const whyNot = (e) => {
      let o = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) o *= Number(w.getComputedStyle(a).opacity);
      if (!e.checkVisibility({ visibilityProperty: true }) || o <= 0.05) return 'invisible';
      if (w.getComputedStyle(e).pointerEvents !== 'none') {
        let over = 0, n = 0;
        for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) { const x = b[0] + b[2] * fx, y = b[1] + b[3] * fy; if (x < 0 || y < 0 || x >= VW || y >= VH) continue; n++; const t = d.elementFromPoint(x, y); if (t && !(e.contains(t) || t.contains(e))) over++; }
        if (n >= 4 && over >= n - 1) return 'covered';
      }
      return null;
    };
    const whys = all.map(whyNot);
    if (whys.every(Boolean)) out.push({ layer: all[0].getAttribute('data-dm') ?? (all[0].localName + '.' + (all[0].getAttribute('class') ?? '').split(' ')[0]), why: whys[0], box: b.map(Math.round) });
  }
  return out;
})()`;

export default async function picking(t) {
  await t.sleep(9000); // intros
  const span = await t.fev(`Math.max(0, d.documentElement.scrollHeight - w.innerHeight)`);
  // The editor's boxes of one state, in the site's coordinates
  const drawn = (states) =>
    t.ev(`(() => { const frame = document.querySelector('iframe'); if (!frame) return []; const r = frame.getBoundingClientRect(); const k = r.width / frame.contentWindow.innerWidth; return [...document.querySelectorAll(${JSON.stringify(states.map((s) => `[data-state="${s}"]`).join(","))})].map((f) => { const b = f.getBoundingClientRect(); return [(b.left - r.left) / k, (b.top - r.top) / k, b.width / k, b.height / k]; }).filter((b) => b[2] > 0 && b[3] > 0); })()`);
  const sameBox = (a, b) => {
    const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return w > 0 && h > 0 && (w * h) / (a[2] * a[3] + b[2] * b[3] - w * h) >= 0.8;
  };
  const same = (boxes, b) => boxes.some((a) => sameBox(a, b));
  const holds1 = (boxes, x, y) => boxes.some((b) => x >= b[0] - 1 && x <= b[0] + b[2] + 1 && y >= b[1] - 1 && y <= b[1] + b[3] + 1);
  const pickedName = () => t.ev(`[...document.querySelectorAll('h2,h3')].map(h => h.textContent.trim())[0] ?? ''`);
  // Where a marked thing is now (site coordinates): the box of what can be seen of it (cut by whatever crops it),
  // and the box of its own size around its middle when it, or something it sits in, is turned (the editor outlines a
  // turned thing at its own size, as a design tool does)
  const where = (thing) =>
    t.fev(`(() => { const e = d.querySelector('[data-pk-thing="${thing.mark}"]'); if (!e) return null; const r = e.getBoundingClientRect(); let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom, angle = 0; for (let p = e, n = 0; p && p !== d.body && n < 20; p = p.parentElement, n++) { const s = w.getComputedStyle(p); const m = s.transform && s.transform !== 'none' ? s.transform.match(/matrix\\(([^)]+)\\)/) : null; if (m && !angle) { const v = m[1].split(',').map(Number); if (Math.abs(v[1]) > 0.01) angle = Math.atan2(v[1], v[0]); } if (p === e || (s.overflowX === 'visible' && s.overflowY === 'visible')) continue; const c = p.getBoundingClientRect(); x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom); } const box = [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)]; const cx = x0 + box[2] / 2, cy = y0 + box[3] / 2; let o = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) o *= Number(w.getComputedStyle(a).opacity); const seen = e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && o > 0.1; let own = null; if (angle && box[2] > 0 && box[3] > 0) { const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle)); const ratio = e.offsetWidth && e.offsetHeight ? e.offsetWidth / e.offsetHeight : box[2] / box[3]; const h = (box[2] / (ratio * cos + sin) + box[3] / (ratio * sin + cos)) / 2; own = [cx - (h * ratio) / 2, cy - h / 2, h * ratio, h]; } return { box, own, x: cx, y: cy, seen }; })()`);
  // Whether one of the boxes drawn with those states is on the thing, where it is at this moment
  const on = async (states, thing) => {
    const boxes = await drawn(states);
    const now = thing.mark ? await where(thing) : null;
    const again = thing.mark ? await drawn(states) : boxes; // a moving thing: drawn before or after it was read
    const targets = now ? [now.box, ...(now.own ? [now.own] : [])] : [thing.box];
    return targets.some((b) => same(boxes, b) || same(again, b));
  };
  // The point to click for a thing: its middle, where it is now. A thing that has left the screen since it was
  // found (a marquee carried it out) or faded away (a card going round the back of a ring) can't be tried: LEFT is
  // thrown, and the thing isn't counted.
  const LEFT = new Error("left the screen");
  const size = await t.fev(`[w.innerWidth, w.innerHeight]`);
  const aim = async (thing) => {
    const now = thing.mark ? await where(thing) : null;
    if (thing.mark && (!now || !now.seen || now.box[2] < 8 || now.box[3] < 8 || now.x < 2 || now.y < 2 || now.x > size[0] - 2 || now.y > size[1] - 2)) throw LEFT;
    return t.toEditor(now ? now.x : thing.x, now ? now.y : thing.y);
  };
  const anyPicked = () => t.ev(`!!document.querySelector('[data-active="true"]')`);
  // Nothing picked: Escape goes up one level at a time (in versions before the click rule, one press drops the pick)
  const escape = async () => {
    for (let n = 0; n < 8; n++) {
      await t.key("Escape", "Escape", 27);
      await t.sleep(200);
      if (!(await anyPicked())) break;
    }
  };
  const typing = async () => (await t.fev(`!!(d.activeElement && d.activeElement.isContentEditable)`)) || (await t.ev(`!!(document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable))`));
  const press = async (x, y, modifiers = 0) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await t.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, modifiers });
    await t.sleep(600);
  };
  // A double-click, and out of the typing it starts on words (Escape there puts the words back and keeps the pick)
  const double = async (x, y) => {
    for (const clickCount of [1, 2]) for (const type of ["mousePressed", "mouseReleased"]) await t.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount });
    await t.sleep(700);
    if (await typing()) {
      await t.key("Escape", "Escape", 27);
      await t.sleep(400);
    }
  };
  const park = () => t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none" });
  const point = async (x, y) => {
    await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 2, y: y + 1, button: "none" });
    await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await t.sleep(160);
  };

  // --- reaching a thing by the settled rule. Leaves it picked when reached.
  // By clicks: a click, then up to INSIDE double-clicks at the same point
  const byClicks = async (thing) => {
    await press(...(await aim(thing)));
    const first = { boxes: await drawn(["selected"]), name: await pickedName() };
    let clicks = (await on(["selected"], thing)) ? 1 : 0;
    for (let n = 1; n <= INSIDE && !clicks; n++) {
      await double(...(await aim(thing)));
      if (await on(["selected"], thing)) clicks = 1 + n;
    }
    return { first, clicks };
  };
  // From the list: the block is picked on the page (its row shows, the rows above it open), then its row is opened
  // and the rows under it are looked at, each by putting the pointer on it (the editor outlines its thing on the
  // page). The thing's row is the one whose outline is the thing's box; one click on it picks it.
  const rowsUnderActive = (from) =>
    t.ev(`(() => { const start = ${from === null ? `document.querySelector('[data-active="true"]')?.closest('li')` : `document.querySelector('[data-pk="${from}"]')?.closest('li')`}; if (!start) return []; window.__pk = window.__pk ?? 0; const out = []; for (const li of start.querySelectorAll(':scope > ul > li')) { const row = li.firstElementChild; const b = row?.querySelector('button[data-layer]'); if (!b) continue; const id = String(++window.__pk); row.setAttribute('data-pk', id); out.push(id); } return out; })()`);
  const rowAt = (id) => t.ev(`(() => { const row = document.querySelector('[data-pk="${id}"]'); if (!row) return null; row.scrollIntoView({ block: 'nearest' }); const b = row.querySelector('button[data-layer]').getBoundingClientRect(); const tw = row.querySelector('button[aria-expanded]'); const r = tw?.getBoundingClientRect(); return { x: b.left + Math.min(60, b.width / 2), y: b.top + b.height / 2, closed: tw ? tw.getAttribute('aria-expanded') === 'false' : false, twist: r ? [r.left + r.width / 2, r.top + r.height / 2] : null }; })()`);
  const fromList = async (thing) => {
    await escape();
    await press(...(await aim(thing)));
    if (!(await anyPicked())) return false;
    // The picked block's own row first: open it when it is closed
    await t.ev(`(() => { for (const e of document.querySelectorAll('[data-pk]')) e.removeAttribute('data-pk'); document.querySelector('[data-active="true"]')?.setAttribute('data-pk', 'top'); })()`);
    const top = await rowAt("top");
    if (top?.closed && top.twist) {
      await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: top.twist[0], y: top.twist[1], button: "none" });
      await t.click(top.twist[0], top.twist[1]);
      await t.sleep(350);
    }
    let queue = await rowsUnderActive("top");
    for (let looked = 0; queue.length && looked < ROWS; looked++) {
      const id = queue.shift();
      const row = await rowAt(id);
      if (!row) continue;
      await point(row.x, row.y);
      const shown = await drawn(["hover"]);
      if (await on(["hover"], thing)) {
        await t.click(row.x, row.y);
        await t.sleep(700);
        await park();
        await t.sleep(150);
        return on(["selected"], thing);
      }
      // A row whose thing holds the thing's middle (or shows no outline to go by): what is under it is looked at next
      const now = thing.mark ? await where(thing) : null;
      if (!shown.length || holds1(shown, now ? now.x : thing.x, now ? now.y : thing.y)) {
        if (row.closed && row.twist) {
          await t.click(row.twist[0], row.twist[1]);
          await t.sleep(350);
        }
        queue = [...(await rowsUnderActive(id)), ...queue];
      }
    }
    await park();
    return false;
  };

  // The top rows of the list (sections), and where the page is scrolled to see each
  // also: a section taller than a screen and a half (a pinned story, a long section) is looked at in three more
  // places along its height: what it holds shows at different moments of its scroll
  const rowsOf = () => t.ev(`(() => { const d = document.querySelector('iframe').contentDocument; const w = d.defaultView; const out = []; for (const b of document.querySelectorAll('button[data-layer]')) { const row = b.parentElement; if (Number(row.style.getPropertyValue('--depth') || 0) !== 0 || b.dataset.layer === 'site') continue; const id = b.dataset.layer; const el = d.querySelector('[data-dm="' + id + '"]'); const r = el?.getBoundingClientRect(); const top = r ? w.scrollY + r.top : 0; out.push({ id, label: ([...b.children].find((c) => c.tagName === 'SPAN')?.textContent ?? b.textContent).trim(), kids: !!row.querySelector('button[aria-expanded]'), at: r && r.height > 0 ? Math.max(0, Math.round(top + Math.max(0, (r.height - w.innerHeight) / 2))) : null, also: r && r.height > w.innerHeight * 1.5 ? [0.1, 0.3, 0.7, 0.9].map((f) => Math.max(0, Math.round(top + (r.height - w.innerHeight) * f))) : [] }); } return out; })()`);
  const rows = await rowsOf();
  const tops = rows.map((r) => r.id);
  let places = [...new Set(rows.filter((r) => r.at !== null).flatMap((r) => [r.at, ...r.also]).map((y) => Math.min(span, y)))].sort((a, b) => a - b);
  if (places.length < 4) places = Array.from({ length: PLACES }, (_, i) => Math.round((span * i) / (PLACES - 1)));
  if (places.length > MOST) places = places.filter((_, i) => i % Math.ceil(places.length / MOST) === 0);
  const holds = {}; // per top row: the most things seen inside it while it was on screen
  const things = []; // every block and piece tried
  const phantoms = [];
  let outlines = 0;
  let left = 0; // things that moved off the screen or faded out before they could be tried
  let allBlocks = 0;
  let mappedBlocks = 0;
  const seenBoxes = new Set();
  const judge = async (at, boxes) => {
    const fresh = boxes.filter((b) => { const k = `${at}:${b.map((v) => Math.round(v / 4)).join(",")}`; if (seenBoxes.has(k)) return false; seenBoxes.add(k); return true; });
    outlines += fresh.length;
    for (const p of await t.fev(PHANTOMS(fresh))) phantoms.push({ at, ...p });
  };
  const frame = await t.ev(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  for (const at of places) {
    await escape();
    await park();
    await t.fev(`w.scrollTo(0, ${at})`);
    await t.sleep(1200);
    // 3. what is outlined here with nothing picked: at rest (the pointer away), and under the pointer as it is put
    // on twelve places of the screen
    await judge(at, await drawn(["idle", "hover", "deeper", "ghost"]));
    for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.15, 0.38, 0.62, 0.85]) {
      await point(frame.x + frame.w * fx, frame.y + frame.h * fy);
      await judge(at, await drawn(["hover", "deeper"]));
    }
    await park();
    const screen = await t.fev(ON_SCREEN(tops));
    allBlocks += screen.allBlocks;
    mappedBlocks += screen.mappedBlocks;
    for (const [id, n] of Object.entries(screen.holds)) holds[id] = Math.max(holds[id] ?? 0, n);
    const fresh = (k) => !things.some((x) => x.what === k.what && x.words === k.words && x.box[2] === k.box[2] && x.box[3] === k.box[3]); // a sticky thing is tried once
    for (const thing of [...screen.blocks.map((b) => ({ ...b, big: true })), ...screen.pieces.map((p) => ({ ...p, big: false }))].filter(fresh)) {
      await escape();
      // Whether it moves by itself (a marquee, a floating bubble): where it is, twice
      const w1 = await where(thing);
      await t.sleep(400);
      const w2 = await where(thing);
      if (!w1 || !w2) continue; // the page took it away
      const moving = Math.abs(w1.x - w2.x) + Math.abs(w1.y - w2.y) > 1.5;
      try {
      const [x, y] = await aim(thing);
      // 2. the box under the pointer before the click
      await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 1, y: y + 1, button: "none" });
      await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
      await t.sleep(320);
      const hover = await drawn(["hover", "deeper"]);
      const hoverIsThing = await on(["hover", "deeper"], thing);
      if (!moving) await judge(at, hover);
      // 1. by clicks; else from the list; and, for information, with ⌘
      const { first, clicks } = await byClicks(thing);
      const list = clicks ? false : await fromList(thing);
      let withCommand = false;
      if (!clicks && !list) {
        await escape();
        await press(...(await aim(thing)), 4);
        withCommand = await on(["selected"], thing);
      }
      const firstBox = first.boxes.find((b) => holds1([b], w2.x, w2.y)) ?? first.boxes[0] ?? null;
      things.push({
        at,
        moving,
        big: thing.big,
        what: thing.what,
        words: thing.words,
        box: thing.box,
        point: [thing.x, thing.y],
        layer: thing.layer,
        clicks, // 1: the first click; 2, 3: after one or two double-clicks; 0: not by clicks
        list, // by its row in the list
        withCommand,
        hoverShown: hover.length > 0,
        // A thing that moves is somewhere else by the time it is clicked: its boxes before and after can't be compared
        hoverIsPick: hover.length > 0 && first.boxes.length > 0 && (moving || hover.some((h) => same(first.boxes, h))),
        hoverIsThing,
        pickHoldsPoint: first.boxes.length > 0 && (moving || holds1(first.boxes, w2.x, w2.y)),
        firstPick: first.name,
        // How big the first pick is next to the thing clicked: a first click should land on the block, not on a sliver of it
        firstPickSmaller: !!firstBox && thing.big && firstBox[2] * firstBox[3] < thing.box[2] * thing.box[3] * 0.5,
      });
      } catch (err) {
        if (err !== LEFT) throw err;
        left++;
      }
    }
  }
  await escape();

  // 2. the same first click after a reload (blocks only)
  const again = things.filter((x) => x.big && !x.moving).slice(0, 14);
  await t.fev(`w.location.reload()`);
  await t.sleep(9000);
  let stable = 0;
  const moved = [];
  for (const thing of again) {
    await escape();
    await t.fev(`w.scrollTo(0, ${thing.at})`);
    await t.sleep(2500); // a page that has just loaded reveals the place as it is scrolled to
    const [x, y] = await t.toEditor(thing.point[0], thing.point[1]);
    await press(x, y);
    const name = await pickedName();
    if (name === thing.firstPick) stable++;
    else moved.push(`"${thing.words}" at ${thing.at}: ${thing.firstPick || "nothing"} → ${name || "nothing"}`);
  }
  await escape();

  // 3. sections that were full on screen and are empty in the list
  const sections = rows.map((r) => ({ id: r.id, label: r.label, kids: r.kids, inside: holds[r.id] ?? 0 }));

  // 5. the selection stays on its thing: the deepest thing that was reached, picked again, then the page reloaded,
  // another device size and back, and the editor itself reloaded. Each time: is the same thing still picked (its
  // name), and is its outline where the thing is.
  const stays = { thing: null, page: null, size: null, editor: null };
  const still0 = things.filter((x) => !x.moving);
  const deep = still0.filter((x) => x.clicks > 1 || x.list).pop() ?? still0.filter((x) => x.clicks).pop();
  if (deep) {
    const go = async () => {
      await t.fev(`w.scrollTo(0, ${deep.at})`);
      await t.sleep(1200);
    };
    await go();
    await escape();
    const again = { box: deep.box, x: deep.point[0], y: deep.point[1] }; // by its place: the page that marked it may be gone
    const reached = (await byClicks(again)).clicks > 0 || (await fromList(again));
    await park();
    const name = await pickedName();
    stays.thing = `${deep.words || deep.what} (${deep.clicks ? `${deep.clicks === 1 ? "a click" : `a click and ${deep.clicks - 1} double-click${deep.clicks > 2 ? "s" : ""}`}` : "from the list"})`;
    // A page that has just loaded takes a moment to draw the place again (an intro, a reveal on scroll)
    const still = async () => {
      for (let n = 0; n < 16; n++) {
        if ((await pickedName()) === name && same(await drawn(["selected"]), deep.box)) return true;
        await t.sleep(500);
      }
      return false;
    };
    if (reached) {
      await t.fev(`w.location.reload()`);
      await t.sleep(9000);
      await go();
      stays.page = await still();
      await t.ev(`[...document.querySelectorAll('button[role="radio"]')].find((b) => /Tablet/.test(b.textContent))?.click()`);
      await t.sleep(2500);
      const atTablet = (await pickedName()) === name;
      await t.ev(`[...document.querySelectorAll('button[role="radio"]')].find((b) => /Desktop/.test(b.textContent))?.click()`);
      await t.sleep(2500);
      await go();
      stays.size = atTablet && (await still());
      await t.ev(`location.reload()`);
      await t.sleep(4000);
      for (let i = 0; i < 80 && !(await t.ev(`document.querySelectorAll('button[data-layer]').length`).catch(() => 0)); i++) await t.sleep(250);
      await t.sleep(9000);
      await go();
      stays.editor = await still();
    }
    await escape();
  }

  // 4. a weak computer: the processor slowed, the pointer swept over the page
  await t.send("Profiler.enable");
  await t.send("Profiler.setSamplingInterval", { interval: 500 });
  await t.fev(`w.scrollTo(0, ${Math.round(span * 0.3)})`);
  await t.sleep(1200);
  const frames = async (ms, act) => {
    await t.fev(`(() => { const k = (w.__pk = { n: 0, slow: 0, on: true }); let last = w.performance.now(); const f = () => { const n = w.performance.now(); if (n - last > 50) k.slow++; last = n; k.n++; if (k.on) w.requestAnimationFrame(f); }; w.requestAnimationFrame(f); return 1; })()`);
    await t.send("Profiler.start");
    const t0 = Date.now();
    await act();
    const left = ms - (Date.now() - t0);
    if (left > 0) await t.sleep(left);
    const { profile } = await t.send("Profiler.stop");
    const r = await t.fev(`(() => { w.__pk.on = false; return { n: w.__pk.n, slow: w.__pk.slow }; })()`);
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    let ours = 0;
    profile.samples.forEach((s, k) => {
      if (/__inspector|inspector\.js/.test(byId.get(s).callFrame.url)) ours += (profile.timeDeltas[k] ?? 0) / 1000;
    });
    const secs = (Date.now() - t0) / 1000;
    return { fps: Math.round(r.n / secs), slowFrames: r.slow, inspectorMsPerSec: Math.round(ours / secs) };
  };
  const box = await t.ev(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const sweep = async (ms) => {
    const t0 = Date.now();
    for (let k = 0; Date.now() - t0 < ms; k++) {
      await t.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.w * (0.1 + 0.8 * Math.abs(((k * 7) % 200) / 100 - 1)), y: box.y + box.h * (0.1 + 0.8 * Math.abs(((k * 3) % 200) / 100 - 1)), button: "none" });
      await t.sleep(16);
    }
  };
  const full = { still: await frames(2500, async () => {}), sweep: await frames(3000, () => sweep(3000)) };
  await t.send("Emulation.setCPUThrottlingRate", { rate: SLOW });
  const weak = { still: await frames(2500, async () => {}), sweep: await frames(3000, () => sweep(3000)) };
  await t.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await park();

  return { things, left, phantoms, outlines, allBlocks, mappedBlocks, stable: { same: stable, of: again.length, moved }, sections, stays, energy: { full, weak } };
}

// --- the numbers a person reads
const reached = (x) => x.clicks > 0 || !!x.list;
const yes = (v) => (v === null || v === undefined ? "not tried" : v ? "yes" : "no");
export function summary(run) {
  const big = run.things.filter((x) => x.big);
  const share = (list, f) => `${list.filter(f).length} of ${list.length}`;
  const all = run.things;
  const empty = run.sections.filter((s) => !s.kids && s.inside >= 3);
  const got = all.filter(reached).length;
  return {
    "1 reach: by the settled rule (clicks, or its row)": `${got} of ${all.length}${all.length ? ` (${Math.round((got / all.length) * 100)}%)` : ""}`,
    "1 reach: by the first click": share(all, (x) => x.clicks === 1),
    "1 reach: by a click and one or two double-clicks": share(all, (x) => x.clicks > 1),
    "1 reach: from its row in the list only": share(all, (x) => !x.clicks && x.list),
    "1 reach: only with ⌘ (not the rule)": share(all, (x) => !reached(x) && x.withCommand),
    "1 reach: not at all": share(all, (x) => !reached(x) && !x.withCommand),
    "1 reach: (left the screen or faded out before being tried)": String(run.left ?? 0),
    "2 predictable: a box shows under the pointer": share(all, (x) => x.hoverShown),
    "2 predictable: that box is what the click picks": share(all.filter((x) => x.hoverShown), (x) => x.hoverIsPick),
    "2 predictable: the pick holds the point clicked": share(all, (x) => x.pickHoldsPoint),
    "2 predictable: same pick after a reload": `${run.stable.same} of ${run.stable.of}`,
    "3 phantoms: outlines over nothing to see": `${run.phantoms.length} of ${run.outlines}`,
    "3 hovering a big block outlines it": share(big, (x) => x.hoverIsThing),
    "3 first click lands on a sliver of the block": share(big, (x) => x.firstPickSmaller),
    "3 sections full on the page, empty in the list": `${empty.length} of ${run.sections.length}${empty.length ? ` (${empty.map((s) => s.label).join(", ")})` : ""}`,
    "4 weak computer, still: frames a second": `${run.energy.weak.still.fps} (full speed ${run.energy.full.still.fps})`,
    "4 weak computer, pointer moving: frames a second": `${run.energy.weak.sweep.fps} (full speed ${run.energy.full.sweep.fps})`,
    "4 inspector's own work, pointer moving": `${run.energy.weak.sweep.inspectorMsPerSec} ms of each second on the weak computer (${run.energy.full.sweep.inspectorMsPerSec} at full speed)`,
    "5 stays: the thing tried": run.stays?.thing ?? "none reached",
    "5 stays: after the page reloads": yes(run.stays?.page),
    "5 stays: at another size and back": yes(run.stays?.size),
    "5 stays: after the editor reloads": yes(run.stays?.editor),
  };
}

const count = (run, f) => run.things.filter(f).length;
export function comparePicking(a, b) {
  const lines = [];
  const A = summary(a);
  const B = summary(b);
  for (const k of Object.keys(B)) if (A[k] !== B[k] && !k.startsWith("4 ")) lines.push(`${k}: ${A[k]} → ${B[k]}`);
  return { summary: `reached by the rule ${count(a, reached)} of ${a.things.length} → ${count(b, reached)} of ${b.things.length}; phantoms ${a.phantoms.length} → ${b.phantoms.length}; empty sections ${a.sections.filter((s) => !s.kids && s.inside >= 3).length} → ${b.sections.filter((s) => !s.kids && s.inside >= 3).length}`, lines };
}

// --- on its own, against a site whose server is running
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
  const [url, name = "site"] = args.filter((x, i) => x !== "--json" && args[i - 1] !== "--json");
  const { openEditor } = await import("./cdp.mjs");
  const t = await openEditor(url);
  let run;
  try {
    run = await picking(t);
  } finally {
    t.close();
  }
  if (json) writeFileSync(json, JSON.stringify(run, null, 1));
  console.log(`\n${name}`);
  for (const [k, v] of Object.entries(summary(run))) console.log(`  ${k.padEnd(52)} ${v}`);
  process.exit(0);
}
