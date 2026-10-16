#!/usr/bin/env node
// Tile images into one labelled sheet and report each image's average colour and
// brightness, so captures can be compared with references and with each other.
//
// node compare.cjs --out qa/look/sheet.png [--cols 3] [--width 640] [--crop FX,FY,FW,FH] [--grid N] img1.png img2.png ...
//
// --grid N prints each image as an N x N grid of brightness (0-255), a squint test for
// composition: where the large dark masses, the bright open areas and the focal point sit.
//
// --crop takes the same region of every image (fractions of width and height), so a
// light source, an edge or a prop can be compared up close; stats then cover the crop.
//
// Requires the `playwright` package (resolve it with NODE_PATH), like probe.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

function args() {
  const a = { cols: '3', width: '640', files: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
    else a.files.push(argv[i]);
  }
  if (!a.out || a.files.length === 0) {
    console.error('usage: compare.cjs --out SHEET.png [--cols N] [--width PX] IMAGE...');
    process.exit(64);
  }
  return a;
}

const mime = (f) => (/\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : 'image/png');

async function main() {
  const a = args();
  const cols = Number(a.cols);
  const width = Number(a.width);
  const crop = a.crop ? a.crop.split(',').map(Number) : null;
  if (crop && (crop.length !== 4 || crop.some((v) => !(v >= 0 && v <= 1)))) {
    console.error('--crop needs four fractions: FX,FY,FW,FH');
    process.exit(64);
  }
  const items = a.files.map((f) => ({ label: path.basename(f) + (crop ? ` [${a.crop}]` : ''), src: `data:${mime(f)};base64,${fs.readFileSync(f).toString('base64')}` }));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: cols * (width + 8) + 8, height: 400 } });
  await page.setContent(`<html><body style="margin:0;padding:4px;background:#222;font:14px sans-serif;color:#eee;display:grid;grid-template-columns:repeat(${cols},${width}px);gap:8px">
    ${items.map((it) => `<figure style="margin:0"><img src="${it.src}" style="width:${width}px;display:block"><figcaption>${it.label}</figcaption></figure>`).join('')}
  </body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  if (crop) {
    await page.evaluate(([fx, fy, fw, fh, w]) => {
      for (const img of document.images) {
        const c = document.createElement('canvas');
        const sw = img.naturalWidth * fw, sh = img.naturalHeight * fh;
        c.width = w; c.height = Math.round(w * sh / sw);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(img, img.naturalWidth * fx, img.naturalHeight * fy, sw, sh, 0, 0, c.width, c.height);
        img.src = c.toDataURL('image/png');
      }
    }, [...crop, width]);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  }
  const grid = Number(a.grid || 0);
  const grids = grid > 0 ? await page.evaluate((n) => [...document.images].map((img) => {
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    const rows = [];
    for (let y = 0; y < n; y++) {
      const row = [];
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        row.push(String(Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])).padStart(4));
      }
      rows.push(row.join(''));
    }
    return rows;
  }), grid) : null;
  const stats = await page.evaluate(() => [...document.images].map((img) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = Math.max(1, Math.round(64 * img.naturalHeight / img.naturalWidth));
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gr = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    r /= n; gr /= n; b /= n;
    return { r: Math.round(r), g: Math.round(gr), b: Math.round(b), luma: Math.round(0.2126 * r + 0.7152 * gr + 0.0722 * b), warmth: Math.round(r - b) };
  }));
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
  await page.screenshot({ path: a.out, fullPage: true });
  await browser.close();
  const report = items.map((it, i) => ({ image: a.files[i], ...stats[i] }));
  for (const s of report) console.log(`${s.image}\tavg rgb(${s.r},${s.g},${s.b})\tluma ${s.luma}\twarmth(r-b) ${s.warmth}`);
  if (grids) report.forEach((s, i) => console.log(`${s.image} brightness grid ${grid}x${grid}:\n${grids[i].join('\n')}`));
  console.log(`sheet: ${a.out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
