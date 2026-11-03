// Minimal Chrome DevTools Protocol client over the global WebSocket, plus
// discovery of the browser page and Node inspectors we measure.

import { ActionTimeout } from "./util.mjs";

// Bounded waits on protocol replies and on actions. The entry point sets
// them from --cdp-timeout and --action-timeout; 0 waits forever.
export const limits = { cdpMs: 60_000, actionMs: 300_000 };

// The connection or session to a target is gone (process exited, tab
// closed). A measurement cannot continue past this.
export class TargetLost extends Error {}

// A command got no reply within its limit.
export class NoReply extends Error {}

export class Cdp {
  constructor(ws, name) {
    this.ws = ws;
    this.name = name;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = null;
    this.lostSessions = new Map();
    this.lossWatchers = new Set();
    ws.addEventListener("message", (ev) => this.#onMessage(JSON.parse(ev.data)));
    ws.addEventListener("close", () => this.#lose(`connection to ${this.name} closed`));
    ws.addEventListener("error", () => this.#lose(`connection to ${this.name} failed`));
  }

  #onMessage(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
      else p.res(msg.result);
      return;
    }
    if (msg.method === "Target.detachedFromTarget") this.#loseSession(msg.params.sessionId, "page target detached (tab closed or crashed)");
    if (msg.method === "Inspector.detached") this.#lose(`${this.name} inspector detached: ${msg.params.reason}`);
    if (msg.method === "Inspector.targetCrashed") {
      if (msg.sessionId) this.#loseSession(msg.sessionId, "page crashed");
      else this.#lose(`${this.name} crashed`);
    }
    for (const l of this.listeners) l(msg);
  }

  #lose(reason) {
    if (this.closed) return;
    this.closed = reason;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.rej(new TargetLost(`${p.method}: ${reason}`)); }
    this.pending.clear();
    for (const w of [...this.lossWatchers]) w.fn(reason);
  }

  #loseSession(sessionId, reason) {
    this.lostSessions.set(sessionId, reason);
    for (const [id, p] of this.pending) {
      if (p.sessionId !== sessionId) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.rej(new TargetLost(`${p.method}: ${reason}`));
    }
    for (const w of [...this.lossWatchers]) if (w.sessionId === sessionId) w.fn(reason);
  }

  // Calls fn(reason) once the connection, or the session if given, is
  // lost (at once if it already is). Returns a function that unsubscribes.
  watchLoss(sessionId, fn) {
    const lost = this.closed ?? (sessionId && this.lostSessions.get(sessionId));
    if (lost) { queueMicrotask(() => fn(lost)); return () => {}; }
    const w = { sessionId, fn };
    this.lossWatchers.add(w);
    return () => this.lossWatchers.delete(w);
  }

  static connect(url, name) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { ws.close(); rej(new Error(`no answer from ${url} within ${limits.cdpMs}ms`)); }, limits.cdpMs || 2 ** 31 - 1);
      ws.addEventListener("open", () => { clearTimeout(timer); res(new Cdp(ws, name)); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); rej(new Error(`cannot connect to ${url}`)); }, { once: true });
    });
  }

  // timeoutMs: per-command reply limit (defaults to --cdp-timeout; 0 = none).
  send(method, params = {}, { sessionId, timeoutMs = limits.cdpMs } = {}) {
    const lost = this.closed ?? (sessionId && this.lostSessions.get(sessionId));
    if (lost) return Promise.reject(new TargetLost(`${method}: ${lost}`));
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          rej(new NoReply(`${method} on ${this.name}: no reply within ${timeoutMs}ms (raise --cdp-timeout, 0 waits forever)`));
        }, timeoutMs)
        : undefined;
      this.pending.set(id, { res, rej, method, sessionId, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() { this.ws.close(); }
}

// A Target is one JS heap we measure: the browser page (flat session on the
// browser socket, so SystemInfo works too) or a Node inspector.
export function makeTarget(kind, name, cdp, sessionId) {
  return {
    kind,
    name,
    cdp,
    sessionId,
    send: (method, params, o) => cdp.send(method, params, { ...o, sessionId }),
    on: (method, fn) => cdp.on((msg) => { if (msg.method === method && msg.sessionId === sessionId) fn(msg.params); }),
    // Resolves on the next matching event. Rejects with TargetLost when the
    // target goes, and with ActionTimeout after timeoutMs (0 = never; flag
    // names the limit). cancel() drops the listeners and timer without
    // settling.
    waitFor(method, timeoutMs = 0, pred = () => true, flag = "--action-timeout") {
      let off, unwatch, timer;
      const promise = new Promise((res, rej) => {
        off = this.on(method, (p) => { if (pred(p)) { cancel(); res(p); } });
        unwatch = cdp.watchLoss(sessionId, (reason) => { cancel(); rej(new TargetLost(`waiting for ${method}: ${reason}`)); });
        if (timeoutMs > 0) timer = setTimeout(() => { cancel(); rej(new ActionTimeout(`no ${method} within ${timeoutMs}ms (raise ${flag}, 0 waits forever)`)); }, timeoutMs);
      });
      const cancel = () => { off(); unwatch(); clearTimeout(timer); };
      promise.catch(() => {});
      return { promise, cancel };
    },
  };
}

export const browserPort = (opts) => Number(opts.port ?? process.env.CDT_PORT ?? 9222);

export async function getJson(p, path) {
  const r = await fetch(`http://127.0.0.1:${p}${path}`, { signal: AbortSignal.timeout(2000) });
  return r.json();
}

export async function connectPage(opts) {
  const p = browserPort(opts);
  const version = await getJson(p, "/json/version").catch(() => {
    throw new Error(`no Chrome on port ${p}. Run "cdt launch" or start Chrome with --remote-debugging-port=${p}.`);
  });
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl, "browser");
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  const info = opts.target ? pages.find((t) => t.url.includes(opts.target)) : pages[0];
  if (!info) throw new Error(opts.target ? `no page with URL containing "${opts.target}"` : "no page targets open");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: info.targetId, flatten: true });
  const t = makeTarget("page", "browser", cdp, sessionId);
  t.url = info.url;
  t.targetId = info.targetId;
  return t;
}

export function parsePorts(spec) {
  if (spec === "auto") return range("9229-9239");
  return String(spec).split(",").flatMap((s) => (s.includes("-") ? range(s) : [Number(s)]));
}

function range(s) {
  const [a, b] = s.split("-").map(Number);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export async function probeNode(p) {
  const list = await getJson(p, "/json/list").catch(() => null);
  const entry = list?.find((t) => t.type === "node");
  if (!entry) return null;
  const cdp = await Cdp.connect(entry.webSocketDebuggerUrl, `node:${p}`);
  const t = makeTarget("node", `node:${p}`, cdp);
  const info = await evaluate(t, `({ pid: process.pid, argv: process.argv.slice(1).join(" ") })`).catch(() => ({}));
  t.port = p;
  t.pid = info.pid;
  t.argv = info.argv ?? entry.title;
  t.name = `node:${p} pid ${info.pid}`;
  cdp.name = t.name;
  return t;
}

export async function connectNodes(opts) {
  if (!opts.node) return [];
  const ports = parsePorts(opts.node);
  const found = (await Promise.all(ports.map(probeNode))).filter(Boolean);
  if (!found.length) throw new Error(`no Node inspector on ${ports.join(", ")}. Start the server with --inspect (Next.js: "next dev --inspect").`);
  return found;
}

export async function evaluate(t, expression, { timeoutMs } = {}) {
  const r = await t.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, { timeoutMs });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`${t.name} threw: ${d.exception?.description ?? d.text}`);
  }
  return r.result.value;
}
