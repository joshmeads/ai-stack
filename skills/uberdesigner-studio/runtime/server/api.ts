// The /__inspector routes: the editor page, the panel's files, and one handler that sends each request to the module
// that does the work. The list of routes is at the top of core.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { detectStack } from "./adapters.ts";
import { fontList, readNumber, saveMedia } from "./direct.ts";
import { totals } from "./savings.ts";
import { sentChars } from "./slices.ts";
import { allowRequest, apiToken } from "./access.ts";
import { findClaude } from "./claude.ts";
import { onlyStyles } from "./css-write.ts";
import { clean, type DirectRequest, editText, keyOf, paramsOf, partOf, setParam, swapString, type TextRequest } from "./direct-changes.ts";
import { predict } from "./estimates.ts";
import { ensureHistory, historyView, restore, withWriteLock, withState } from "./history.ts";
import { body, reply } from "./http.ts";
import { jobs, MAX_PARALLEL, type RunRequest } from "./jobs.ts";
import { mapCheck } from "./map-check.ts";
import { keepLayer, type PickedLayer } from "./layers.ts";
import { mapChangedAt } from "./map-store.ts";
import { type MotionRequest, setMotion } from "./motion.ts";
import { contextFor, describeContext } from "./part.ts";
import { pending, saveCards, startRun, stopJob, threadOf } from "./queue.ts";
import { save } from "./save.ts";
import { settingFlagCounts, settingFlagsFor, settingOk } from "./settings.ts";
import { DATA_URI, exec, readMap, readSite, ROOT, safePath, stale, STATE, view } from "./site.ts";
import { bringBack, chooseTry, comparing, keepThread, startCompare, undoEdit, undoThread } from "./threads.ts";

export type Status = { installed: boolean; version?: string; loggedIn: boolean; method?: string; account?: string; expires?: string };

export async function status(res: ServerResponse) {
  const bin = findClaude();
  const version = await exec(bin, ["--version"]);
  if (version.code !== 0) return reply(res, 200, { ok: true, status: { installed: false, loggedIn: false } satisfies Status });
  const s: Status = { installed: true, version: version.out.trim().split(" ")[0], loggedIn: false };
  if (process.env.ANTHROPIC_API_KEY) {
    s.loggedIn = true;
    s.method = "API key (ANTHROPIC_API_KEY)";
    return reply(res, 200, { ok: true, status: s });
  }
  try {
    const auth = JSON.parse((await exec(bin, ["auth", "status", "--json"])).out) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
      loginExpiresAt?: string;
    };
    s.loggedIn = !!auth.loggedIn;
    s.method = auth.authMethod === "claude.ai" ? "Claude subscription" : auth.authMethod ? "Anthropic Console (API billing)" : undefined;
    s.account = auth.email;
    s.expires = auth.loginExpiresAt;
  } catch {
    /* an older Claude Code without `auth status`: treat as not signed in; the panel says what to run */
  }
  reply(res, 200, { ok: true, status: s });
}

export function sizes(res: ServerResponse, url: string) {
  const list = new URL(url, "http://x").searchParams.get("files")?.split(",").filter(Boolean) ?? [];
  const out: Record<string, number> = {};
  for (const f of list) {
    try {
      out[f] = statSync(safePath(f)).size - (readFileSync(safePath(f), "utf8").match(DATA_URI) ?? []).reduce((n, m) => n + m.length, 0); // as sent: without embedded data
    } catch {
      /* unknown files are left out */
    }
  }
  reply(res, 200, { ok: true, sizes: out });
}

export async function history(res: ServerResponse) {
  await ensureHistory();
  reply(res, 200, { ok: true, entries: historyView().reverse() });
}

// --- the panel, for both ways of attaching (vite-plugin.ts injects these tags; serve.ts does the same)

export const PANEL = resolve(import.meta.dirname, "..", "panel");
export const PANEL_TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

export function panelTags(): string {
  let map = "{}";
  const at = mapChangedAt(); // read before the map, so the page never holds an older map than it says
  try {
    map = readFileSync(join(ROOT, "inspector.map.json"), "utf8");
  } catch {
    console.warn("uberdesigner studio: no inspector.map.json in the site folder (run the uberdesigner-studio skill's apply)");
  }
  return (
    `\n<!-- uberdesigner studio (dev only; not in the site's files) -->\n` +
    `<link rel="stylesheet" href="/__inspector/panel/inspector.css">\n` +
    `<script>window.__DESIGN_MAP__ = ${map.replace(/<\//g, "<\\/")}; window.__DESIGN_MAP_AT__ = ${at}; window.__INSPECTOR_TOKEN__ = ${JSON.stringify(apiToken())};</script>\n` +
    `<script type="module" src="/__inspector/panel/inspector.js"></script>\n`
  );
}

// The editor tab's icon: the uberdesigner mark (the website's app/icon.svg), black in every theme, written into the
// page so the site's own /favicon.ico, at the same address, stays the site's
const EDITOR_ICON = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%22-0.05 1.9 13.15 13.15%22%3E %3Cstyle%3Epath %7B fill: %23000; %7D%3C/style%3E %3Cpath transform=%22rotate(90 6.527 8.475)%22 d=%22M6.52734 1.94629C8.30587 1.94629 9.91824 2.65805 11.0957 3.81152H7.5918C7.96585 4.3471 8.27561 4.97836 8.50293 5.67773H12.4277C12.7031 6.25759 12.8961 6.88437 12.9902 7.54297H8.8877C8.91747 7.84727 8.93357 8.15828 8.93359 8.47461C8.93359 8.79126 8.91751 9.1036 8.8877 9.4082H12.9902C12.896 10.0667 12.7032 10.6937 12.4277 11.2734H8.50293C8.27565 11.9725 7.96569 12.6033 7.5918 13.1387H11.0957C9.91824 14.2921 8.30586 15.0039 6.52734 15.0039C2.98552 15.0037 0.102669 12.1825 0.00195312 8.66504C0.000671139 8.60194 0 8.53815 0 8.47461C3.12676e-06 8.41094 0.00065982 8.3474 0.00195312 8.28418C0.102953 4.76693 2.9857 1.9465 6.52734 1.94629Z%22/%3E %3C/svg%3E";

// The editor: the inspector's own page, with the site in a frame between its columns (panel-src/inspector/Editor.tsx).
// It carries the same panel bundle and map as every site page; the bundle sees where it is and draws the editor.
export function serveEditor(res: ServerResponse) {
  const name = (readMap().name ?? "site").replace(/[<&]/g, "");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="icon" href="${EDITOR_ICON}">\n` +
      `<title>${name} · uberdesigner studio</title>\n<script>try{var t=localStorage.getItem("uberdesigner-studio-theme");document.documentElement.dataset.studioTheme=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){}</script>\n<style>html,body{margin:0;height:100%;overflow:hidden;background:#080808}html[data-studio-theme=light] body{background:#f4f4f4}</style>\n</head>\n<body>${panelTags()}</body>\n</html>\n`,
  );
}

export function servePanel(url: string, res: ServerResponse) {
  const file = join(PANEL, normalize(url.slice("/__inspector/panel/".length)).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PANEL) || !existsSync(file)) return reply(res, 404, { ok: false, error: "no such panel file" });
  res.writeHead(200, { "Content-Type": PANEL_TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  res.end(readFileSync(file));
}

export function words(res: ServerResponse) {
  const file = readMap().content?.file;
  if (!file || !existsSync(join(ROOT, file))) return reply(res, 200, { ok: true, file: null, words: {} });
  reply(res, 200, { ok: true, file, words: JSON.parse(readFileSync(join(ROOT, file), "utf8")) as unknown });
}

// What a part change would send, before it's sent (the panel shows it and its token estimate)
export async function contextPreview(req: IncomingMessage, res: ServerResponse) {
  const { partId, request = "", files, page } = JSON.parse(await body(req)) as { partId?: string; request?: string; files?: string[]; page?: RunRequest["page"] };
  const sent = contextFor({ partId, request, files, page });
  const chars = sentChars(sent, view);
  reply(res, 200, { ok: true, sources: describeContext(sent), chars, tokens: Math.round(chars / 3.6) + 3000, eta: predict("claude-opus-5-5", "part", chars) });
}

// Every /__inspector/* request. vite-plugin.ts mounts it as middleware; serve.ts calls it directly.
// The site's address opens the studio. A page of the site asked for by a person (a top-level page load: the browser
// says so in Sec-Fetch-Dest) is sent to the editor on that page; the editor's own frame, files, and anything that
// isn't a browser loading a page (curl, a script, a test's fetch) get the site as it is. `?studio=off` on any page
// turns this off for the browser (a cookie holds it), for when the site is wanted on its own in a tab; `?studio=on`
// turns it back on. True when the request was answered here.
const STUDIO_COOKIE = "uberdesigner_studio";
export function toStudio(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET") return false;
  const h = req.headers;
  if (h["sec-fetch-dest"] !== "document" || !String(h.accept ?? "").includes("text/html")) return false;
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://site");
  } catch {
    return false;
  }
  if (url.pathname.startsWith("/__inspector/")) return false;
  if (/\.[a-z0-9]{1,5}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return false; // a file, not a page
  const ask = url.searchParams.get("studio");
  if (ask === "off" || ask === "on") {
    res.setHeader("Set-Cookie", `${STUDIO_COOKIE}=${ask}; Path=/; SameSite=Lax`);
    url.searchParams.delete("studio");
    if (ask === "off") return false;
  } else if (new RegExp(`(?:^|;\\s*)${STUDIO_COOKIE}=off`).test(String(h.cookie ?? ""))) return false;
  res.writeHead(302, { Location: `${"/__inspector/editor"}?${new URLSearchParams({ path: url.pathname + url.search })}`, "Cache-Control": "no-store" });
  res.end();
  return true;
}

export async function handleInspector(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = req.url ?? "";
  if (!url.startsWith("/__inspector/")) return toStudio(req, res) ? undefined : next();
  if (!allowRequest(req, res)) return;
  try {
    if (req.method === "GET" && url.startsWith("/__inspector/panel/")) return servePanel(url.split("?")[0], res);
    if (req.method === "GET" && url.split("?")[0] === "/__inspector/editor") return serveEditor(res);
    if (req.method === "GET") {
      if (url === "/__inspector/words") return words(res);
      if (url === "/__inspector/status") return await status(res);
      if (url.startsWith("/__inspector/sizes")) return sizes(res, url);
      if (url === "/__inspector/jobs")
        return reply(res, 200, { ok: true, jobs: withState([...jobs].reverse()), max: MAX_PARALLEL, comparing: comparing ? { thread: comparing.thread, upTo: comparing.upTo } : null, stale, mapAt: mapChangedAt(), settingFlags: settingFlagCounts() });
      if (url === "/__inspector/history") return await history(res);
      if (url === "/__inspector/map-check") return reply(res, 200, { ok: true, check: mapCheck() });
      // The map as it is now, for the editor to swap its layers in place ("at" is taken first: see panelTags)
      if (url === "/__inspector/map") {
        const at = mapChangedAt();
        return reply(res, 200, { ok: true, map: readMap(), at });
      }
      if (url === "/__inspector/fonts") return reply(res, 200, { ok: true, ...(await fontList(STATE)) });
      if (url === "/__inspector/totals") return reply(res, 200, { ok: true, ...totals(ROOT) });
      if (url.startsWith("/__inspector/params?")) {
        const part = partOf(new URLSearchParams(url.split("?")[1]).get("part") ?? "");
        const values = Object.fromEntries(paramsOf(part).map((p) => [keyOf(p), readNumber(readSite(clean(p.file)) ?? "", p)]));
        return reply(res, 200, { ok: true, values, flags: settingFlagsFor(part.id) });
      }
      if (url === "/__inspector/tokens") {
        const file = readMap().tokensFile;
        const text = file ? readFileSync(safePath(file), "utf8") : "";
        return reply(res, 200, { ok: true, file, css: file && /\.html?$/.test(file) ? onlyStyles(text) : text });
      }
    }
    if (req.method === "POST") {
      if (url === "/__inspector/save") return await save(req, res);
      if (url === "/__inspector/context") return await contextPreview(req, res);
      if (url === "/__inspector/run") {
        const r = JSON.parse(await body(req)) as RunRequest;
        if (comparing) await withWriteLock(async () => undefined); // a new try reads the files as they are: back to "after"
        const j = startRun(r);
        return reply(res, 200, { ok: true, job: j });
      }
      if (url === "/__inspector/stop") {
        const { id } = JSON.parse(await body(req)) as { id: string };
        stopJob(id);
        return reply(res, 200, { ok: true });
      }
      if (url === "/__inspector/dismiss") {
        const { id } = JSON.parse(await body(req)) as { id: string };
        const done = threadOf(id).filter((x) => x.state === "done" || x.state === "error");
        for (const x of done) jobs.splice(jobs.indexOf(x), 1);
        saveCards();
        return reply(res, 200, { ok: true });
      }
      if (url === "/__inspector/observed") {
        // The panel's report of what the page shows after a change landed (the server can't look): kept on the card
        const o = JSON.parse(await body(req)) as { job?: string; width?: number; note?: string };
        const j = jobs.find((x) => x.id === o.job);
        if (!j || typeof o.note !== "string") return reply(res, 400, { ok: false, error: "No such change" });
        j.observed = { at: Date.now(), width: Number(o.width) || 0, note: o.note.replace(/\s+/g, " ").trim().slice(0, 400) };
        saveCards();
        return reply(res, 200, { ok: true });
      }
      if (url === "/__inspector/keep") {
        const { thread } = JSON.parse(await body(req)) as { thread: string };
        if (comparing?.thread === thread) await withWriteLock(async () => undefined);
        keepThread(thread);
        return reply(res, 200, { ok: true });
      }
      if (url === "/__inspector/undo") {
        const { thread } = JSON.parse(await body(req)) as { thread: string };
        if (jobs.some((x) => x.state === "running" && x.mode === "project")) throw new Error("Wait for the Whole site change to finish");
        return reply(res, 200, { ok: true, ...(await undoThread(thread)) });
      }
      if (url === "/__inspector/layer") {
        return reply(res, 200, { ok: true, ...(await keepLayer(JSON.parse(await body(req)) as PickedLayer)) });
      }
      if (url === "/__inspector/bring-back") {
        const { thread } = JSON.parse(await body(req)) as { thread: string };
        if (jobs.some((x) => x.state === "running" && x.mode === "project")) throw new Error("Wait for the Whole site change to finish");
        return reply(res, 200, { ok: true, ...(await bringBack(thread)) });
      }
      if (url === "/__inspector/undo-edit") {
        const { entry } = JSON.parse(await body(req)) as { entry: string };
        return reply(res, 200, { ok: true, ...(await undoEdit(entry)) });
      }
      if (url === "/__inspector/compare") {
        const { thread, side, upTo } = JSON.parse(await body(req)) as { thread: string; side?: "before" | "after"; upTo?: number };
        const at = side === "before" ? 0 : side === "after" ? Infinity : Number(upTo ?? Infinity);
        if (Number.isFinite(at)) {
          if (pending().some((x) => x.mode === "project")) throw new Error("Wait for the Whole site change to finish");
          await startCompare(thread, Math.max(0, at)); // the lock first switches back from any other comparison
        } else await withWriteLock(async () => undefined); // the lock switches back to "after" first
        return reply(res, 200, { ok: true });
      }
      if (url === "/__inspector/text") {
        const t = JSON.parse(await body(req)) as TextRequest;
        if (comparing) await withWriteLock(async () => undefined); // typed over the latest state: back to "after" first
        return reply(res, 200, { ok: true, ...(await editText(t)) });
      }
      if (url === "/__inspector/link") {
        const d = JSON.parse(await body(req)) as DirectRequest & { from: string; to: string };
        if (comparing) await withWriteLock(async () => undefined);
        return reply(res, 200, { ok: true, ...(await swapString({ ...d, what: "link address" })) });
      }
      if (url === "/__inspector/motion") {
        const d = JSON.parse(await body(req)) as MotionRequest;
        if (comparing) await withWriteLock(async () => undefined);
        return reply(res, 200, { ok: true, ...(await setMotion(d)) });
      }
      if (url === "/__inspector/setting-ok") {
        const { partId, key } = JSON.parse(await body(req)) as { partId: string; key: string };
        settingOk(partId, key);
        return reply(res, 200, { ok: true });
      }
      if (url === "/__inspector/param") {
        const d = JSON.parse(await body(req)) as DirectRequest & { name: string; value: number };
        if (comparing) await withWriteLock(async () => undefined);
        return reply(res, 200, { ok: true, ...(await setParam(d)) });
      }
      // A picture or video from the person's computer: saved into the site (public/media/ in a Vite project, media/
      // next to a plain page), then put where the part's old one was
      if (url.startsWith("/__inspector/media?")) {
        const q = new URLSearchParams(url.split("?")[1]);
        const d: DirectRequest = { partId: q.get("part") ?? "", model: q.get("model") ?? "sonnet", effort: q.get("effort") ?? "low", claude: q.get("claude") === "1" };
        partOf(d.partId);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > 50 * 1024 * 1024) throw new Error("That file is over 50 MB");
          chunks.push(c as Buffer);
        }
        if (comparing) await withWriteLock(async () => undefined);
        const saved = saveMedia(ROOT, detectStack(ROOT).id === "vite-react" ? "public" : "", q.get("name") ?? "media", Buffer.concat(chunks));
        const from = q.get("from") ?? "";
        const out = await swapString({ ...d, from, to: saved.url, what: "media source" });
        return reply(res, 200, { ok: true, saved: saved.path, ...out });
      }
      if (url === "/__inspector/choose") {
        const { thread, upTo } = JSON.parse(await body(req)) as { thread: string; upTo: number };
        if (pending().some((x) => x.mode === "project")) throw new Error("Wait for the Whole site change to finish");
        return reply(res, 200, { ok: true, ...(await chooseTry(thread, Math.max(0, Number(upTo) || 0))) });
      }
      if (url === "/__inspector/restore") {
        const { id } = JSON.parse(await body(req)) as { id: string };
        if (pending().length) throw new Error("Wait for the running changes to finish (or stop them)");
        return reply(res, 200, { ok: true, ...(await withWriteLock(() => restore(id))) });
      }
    }
    reply(res, 404, { ok: false, error: "Unknown studio endpoint" });
  } catch (err) {
    reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
