// A headless Chrome tab on the inspector's editor, driven over the DevTools protocol (no packages). The checks get:
//   ev(expr)   evaluate in the editor page        fev(expr)  in the site's frame (w = its window, d = its document)
//   click(x,y) dbl(x,y)  editor coordinates       toEditor(x,y)  site coordinates → editor coordinates
//   send(method, params)  raw protocol             sleep(ms)
// Chrome runs with the GPU (Metal on macOS): with software WebGL, some intros never finish.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test that drives a browser imports this file before it starts a server: the servers they start inherit this,
// and count their scripted changes' "tokens saved" into a temporary folder instead of the person's real total
// (~/.uberdesigner/design-map/totals.json; runtime/server/savings.ts).
process.env.DESIGN_MAP_TOTALS_DIR ??= mkdtempSync(join(tmpdir(), "design-map-totals-"));

// Google Chrome: CHROME names another path. CHROME_FLAGS adds flags (a CI container needs --no-sandbox).
const CHROME = process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const EXTRA_FLAGS = (process.env.CHROME_FLAGS ?? "").split(/\s+/).filter(Boolean);
// A layer's elements on the site's page, for either side of a comparison: the inspector's own attribute, or the
// data-part of versions before 16 Nov 2026
export const layerSelector = (id) => `[data-dm="${id}"],[data-part="${id}"]`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mode: the editor's mode the tab starts in. A site opened for the first time starts in Focus (no layers list, no
// Elements); the checks of the editor's own parts ask for "design", the default here. null leaves it as a person's
// first visit has it. (Versions before the modes ignore the key.)
export async function openEditor(url, { mode = "design" } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "design-map-chrome-"))}`,
      "--hide-scrollbars",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []), // the Mac's own graphics backend
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--no-first-run",
      "--no-default-browser-check",
      "--force-device-scale-factor=1",
      "--window-size=1600,1000",
      ...EXTRA_FLAGS,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r));
      }
    } catch {
      /* not up yet */
    }
    if (!ws) await sleep(250);
  }
  if (!ws) {
    chrome.kill();
    throw new Error(`Chrome didn't start (${CHROME}); set CHROME to its path`);
  }
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.rej(new Error(d.error.message)) : p.res(d.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.enable");
  await send("Runtime.enable");
  if (mode) await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("uberdesigner-studio-mode")) localStorage.setItem("uberdesigner-studio-mode", ${JSON.stringify(mode)}); } catch {}` });
  await send("Page.navigate", { url });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const fev = (expr) => ev(`(() => { const w = document.querySelector('iframe').contentWindow; const d = w.document; return (${expr}); })()`);
  const mouse = (type, x, y, clickCount = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount });
  const click = async (x, y) => {
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
  };
  const dbl = async (x, y) => {
    await click(x, y);
    await mouse("mousePressed", x, y, 2);
    await mouse("mouseReleased", x, y, 2);
  };
  const toEditor = (x, y) => ev(`(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect(); const s = r.width / f.contentWindow.innerWidth; return [r.left + ${x} * s, r.top + ${y} * s]; })()`);
  const key = async (k, code, vk) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  };
  // The editor is ready when its layers list is
  for (let i = 0; i < 240 && !(await ev(`document.querySelectorAll('button[data-layer]').length`).catch(() => 0)); i++) await sleep(250);
  return {
    ev,
    fev,
    click,
    dbl,
    key,
    toEditor,
    send,
    sleep,
    status: () => ev(`document.querySelector('footer')?.innerText.split('\\n')[0] ?? ''`),
    close: () => {
      try {
        ws.close();
      } catch {
        /* closed */
      }
      chrome.kill();
    },
  };
}
