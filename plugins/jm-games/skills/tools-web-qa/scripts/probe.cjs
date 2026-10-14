#!/usr/bin/env node
// Drive a browser game in headless Chromium and record evidence: errors, liveness,
// input response, page scrolling, frame timing, screenshots and optional game state.
//
// node probe.cjs --url http://127.0.0.1:5173 --out qa/run1 \
//   [--steps "wait:1500,key:ArrowRight:800,key:Space:100,click:0.5:0.5,wait:500"] \
//   [--state "JSON.stringify(window.__game?.state)"] [--viewport 1280x720] [--settle 2000]
//
// Requires the `playwright` package (resolve it with NODE_PATH) and a Chromium
// installed by `npx playwright install chromium`.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function args() {
  const a = { steps: 'wait:1000', viewport: '1280x720', settle: '2000', state: '' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.url || !a.out) {
    console.error('usage: probe.cjs --url URL --out DIR [--steps ...] [--state EXPR] [--viewport WxH] [--settle MS]');
    process.exit(64);
  }
  return a;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function main() {
  const a = args();
  fs.mkdirSync(a.out, { recursive: true });
  const [w, h] = a.viewport.split('x').map(Number);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const report = { url: a.url, viewport: a.viewport, console: [], pageErrors: [], failedRequests: [], steps: [], findings: [] };

  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) report.console.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e && e.stack || e)));
  page.on('requestfailed', (r) => report.failedRequests.push(`${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) report.failedRequests.push(`${r.url()} HTTP ${r.status()}`); });
  await page.addInitScript(() => {
    window.__qaFrames = [];
    const tick = (t) => { window.__qaFrames.push(t); if (window.__qaFrames.length > 20000) window.__qaFrames.shift(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  let shotN = 0;
  const shot = async (label) => {
    const buf = await page.screenshot();
    const file = `${String(++shotN).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '_')}.png`;
    fs.writeFileSync(path.join(a.out, file), buf);
    return { file, hash: sha(buf) };
  };
  const readState = async () => (a.state ? page.evaluate((expr) => { try { return String(eval(expr)); } catch (e) { return `ERROR ${e.message}`; } }, a.state) : undefined);

  const t0 = Date.now();
  // Dev servers often take a few seconds to listen; retry refused connections for up to 20 s.
  let resp = null;
  for (let attempt = 0; ; attempt++) {
    try { resp = await page.goto(a.url, { waitUntil: 'load', timeout: 30000 }); break; }
    catch (e) {
      if (/ERR_CONNECTION_REFUSED/.test(e.message) && attempt < 40) { await page.waitForTimeout(500); continue; }
      report.pageErrors.push(`navigation: ${e.message.split('\n')[0]}`); break;
    }
  }
  report.httpStatus = resp ? resp.status() : null;
  report.loadMs = Date.now() - t0;
  await page.waitForTimeout(Number(a.settle));

  report.canvas = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0];
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { count: document.querySelectorAll('canvas').length, width: c.width, height: c.height, cssWidth: Math.round(r.width), cssHeight: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
  });

  // Liveness: does the screen change with no input?
  const idleA = await shot('idle_a');
  await page.waitForTimeout(1000);
  const idleB = await shot('idle_b');
  report.animatesWithoutInput = idleA.hash !== idleB.hash;
  report.stateAtStart = await readState();

  // Give the page keyboard focus without pressing anything: a click in the
  // middle of the screen can hit a menu button or slider. Click the top-left
  // corner, then focus the canvas directly. Use explicit click steps for UI.
  if (report.canvas) {
    await page.mouse.click(2, 2);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0];
      if (c && !c.hasAttribute('tabindex')) c.setAttribute('tabindex', '-1');
      c?.focus({ preventScroll: true });
    });
  }

  for (const raw of a.steps.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [kind, p1, p2] = raw.split(':');
    const before = await shot(`before_${raw}`);
    const scrollBefore = await page.evaluate(() => [window.scrollX, window.scrollY]);
    if (kind === 'wait') await page.waitForTimeout(Number(p1));
    else if (kind === 'key') { await page.keyboard.down(p1); await page.waitForTimeout(Number(p2 || 100)); await page.keyboard.up(p1); }
    else if (kind === 'type') await page.keyboard.type(p1, { delay: 50 });
    else if (kind === 'click') await page.mouse.click(Math.round(w * Number(p1)), Math.round(h * Number(p2)));
    else { report.findings.push(`unknown step ${raw}`); continue; }
    await page.waitForTimeout(150);
    const after = await shot(`after_${raw}`);
    const scrollAfter = await page.evaluate(() => [window.scrollX, window.scrollY]);
    report.steps.push({ step: raw, screenChanged: before.hash !== after.hash, pageScrolled: scrollBefore.join() !== scrollAfter.join(), state: await readState(), shot: after.file });
  }

  // Frame timing over the whole run (headless software GL: compare runs, not absolute numbers).
  report.frames = await page.evaluate(() => {
    const f = window.__qaFrames;
    const d = f.slice(1).map((t, i) => t - f[i]).sort((x, y) => x - y);
    if (!d.length) return null;
    const pct = (p) => +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1);
    return { count: f.length, avgFps: +(1000 / (d.reduce((s, x) => s + x, 0) / d.length)).toFixed(1), p50ms: pct(0.5), p95ms: pct(0.95), maxMs: pct(1) };
  });
  report.stateAtEnd = await readState();
  await shot('end');

  const seen = new Set();
  report.failedRequests = report.failedRequests.filter((r) => { const u = r.split(' ')[0]; return !seen.has(u) && seen.add(u); });
  if (report.httpStatus && report.httpStatus >= 400) report.findings.push(`page returned HTTP ${report.httpStatus}`);
  if (report.pageErrors.length) report.findings.push(`${report.pageErrors.length} uncaught page error(s)`);
  if (report.console.some((c) => c.startsWith('error'))) report.findings.push('console errors present');
  if (report.failedRequests.length) report.findings.push(`${report.failedRequests.length} failed request(s)`);
  if (!report.canvas) report.findings.push('no <canvas> found (fine for DOM games; otherwise the game did not mount)');
  else if (!report.canvas.visible) report.findings.push('canvas has zero size');
  const keySteps = report.steps.filter((s) => s.step.startsWith('key'));
  if (keySteps.length && !keySteps.some((s) => (s.screenChanged && !s.pageScrolled) || (s.state !== undefined && s.state !== report.stateAtStart))) report.findings.push('no key step changed the screen or state');
  if (report.steps.some((s) => s.pageScrolled)) report.findings.push('a step scrolled the page (game keys not captured)');

  fs.writeFileSync(path.join(a.out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ findings: report.findings, animatesWithoutInput: report.animatesWithoutInput, frames: report.frames, steps: report.steps.map((s) => [s.step, s.screenChanged, s.pageScrolled, s.state]) }, null, 2));
  await browser.close();
  process.exit(report.findings.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
