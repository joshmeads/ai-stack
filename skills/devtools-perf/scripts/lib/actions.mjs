// Actions a step can run. prepareAction does the setup that is not part of
// the user's action (find the element, scroll it into view if needed, work
// out coordinates) and returns act(), which the measurement window brackets.

import { spawn } from "node:child_process";
import { evaluate, limits } from "./cdp.mjs";
import { round, sleep, withTimeout } from "./util.mjs";

export const PAGE_ACTIONS = new Set(["click", "type", "press", "eval", "goto"]);

// kind -> minimum number of arguments
const ARITY = { click: 1, type: 2, press: 1, eval: 1, goto: 1, request: 1, idle: 0, run: 1 };

export function validateAction(action, where) {
  if (!Array.isArray(action) || !action.length || !action.every((a) => typeof a === "string")) {
    throw new Error(`${where}: "action" must be a non-empty array of strings, e.g. ["click", "#save"]`);
  }
  const [kind, ...args] = action;
  if (!(kind in ARITY)) throw new Error(`${where}: unknown action "${kind}". See cdt --help.`);
  const needed = ARITY[kind] + (kind === "request" && /^[A-Z]+$/.test(args[0] ?? "") ? 1 : 0);
  if (args.length < needed) throw new Error(`${where}: "${kind}" needs ${needed} argument${needed > 1 ? "s" : ""}. See cdt --help.`);
  if (kind === "idle" && args.length && !(Number(args[0]) >= 0)) throw new Error(`${where}: idle takes milliseconds`);
}

const NAMED_KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
};

function keyDef(name) {
  if (NAMED_KEYS[name]) return { key: name, ...NAMED_KEYS[name] };
  if ([...name].length !== 1) throw new Error(`press: unknown key "${name}"; use a single character or ${Object.keys(NAMED_KEYS).join(", ")}`);
  const up = name.toUpperCase();
  if (/[A-Z]/.test(up)) return { key: name, code: `Key${up}`, keyCode: up.charCodeAt(0), text: name };
  if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
  return { key: name, text: name };
}

const sel = (css) => JSON.stringify(css);

export async function goto(page, url, timeoutMs = limits.actionMs) {
  const load = page.waitFor("Page.loadEventFired", timeoutMs);
  const sameDoc = page.waitFor("Page.navigatedWithinDocument", timeoutMs);
  try {
    const r = await page.send("Page.navigate", { url });
    if (r.errorText) throw new Error(`navigate failed: ${r.errorText}`);
    // No loaderId: same-document navigation (fragment, history API), which
    // fires navigatedWithinDocument and never a load event.
    await (r.loaderId ? load.promise : sameDoc.promise);
  } finally {
    load.cancel();
    sameDoc.cancel();
  }
}

async function request(args, timeoutMs) {
  const method = /^[A-Z]+$/.test(args[0]) ? args.shift() : "GET";
  const [url, body] = args;
  const t0 = performance.now();
  const r = await fetch(url, {
    method,
    body,
    headers: body ? { "content-type": "application/json" } : undefined,
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const ttfb = performance.now() - t0;
  const buf = await r.arrayBuffer();
  return { method, url, status: r.status, ttfbMs: round(ttfb), totalMs: round(performance.now() - t0), bytes: buf.byteLength };
}

function runShell(cmd, timeoutMs) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, { shell: true, stdio: ["ignore", "inherit", "inherit"] });
    const timer = timeoutMs > 0 && setTimeout(() => {
      child.kill("SIGTERM");
      rej(new Error(`"${cmd}" did not finish within ${timeoutMs}ms and was stopped (raise --action-timeout, 0 waits forever)`));
    }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); rej(e); });
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? res() : rej(new Error(`"${cmd}" exited ${code}`)); });
  });
}

// Returns act(). Throws if the action cannot be prepared (missing element).
export async function prepareAction(ctx, action) {
  const [kind, ...args] = action;
  const page = ctx.page;
  const ms = limits.actionMs;
  if (PAGE_ACTIONS.has(kind) && !page) throw new Error(`"${kind}" needs a browser page; none is attached`);
  const bounded = (fn) => () => withTimeout(fn(), ms, `"${action.join(" ")}"`, "--action-timeout");
  switch (kind) {
    case "click": {
      // Scroll only when the centre is off-screen, so an on-screen click
      // does not pay for a scroll it would never have had.
      const box = await evaluate(page, `(() => {
        const el = document.querySelector(${sel(args[0])});
        if (!el) return null;
        let r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) {
          el.scrollIntoView({ block: "center", inline: "center" });
          r = el.getBoundingClientRect();
        }
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!box) throw new Error(`no element matches ${args[0]}`);
      const { x, y } = box;
      return bounded(async () => {
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      });
    }
    case "type": {
      const focused = await evaluate(page, `(() => {
        const el = document.querySelector(${sel(args[0])});
        if (!el) return "missing";
        el.focus();
        return document.activeElement === el ? "ok" : "unfocusable";
      })()`);
      if (focused === "missing") throw new Error(`no element matches ${args[0]}`);
      if (focused !== "ok") throw new Error(`${args[0]} cannot take focus, so typing would go elsewhere`);
      const text = args.slice(1).join(" ");
      return bounded(() => page.send("Input.insertText", { text }));
    }
    case "press": {
      const k = keyDef(args[0]);
      const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
      return bounded(async () => {
        await page.send("Input.dispatchKeyEvent", { ...base, type: k.text ? "keyDown" : "rawKeyDown", text: k.text });
        await page.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
      });
    }
    case "eval":
      return bounded(() => evaluate(page, args.join(" "), { timeoutMs: 0 }));
    case "goto":
      return () => goto(page, args[0], ms);
    case "request":
      return () => request([...args], ms);
    case "idle":
      return () => sleep(Number(args[0] ?? 1000));
    case "run":
      return () => runShell(args.join(" "), ms);
    default:
      throw new Error(`unknown action "${kind}". See cdt --help.`);
  }
}
