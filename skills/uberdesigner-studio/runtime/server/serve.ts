// How the inspector attaches to a site with no build step (the html-static and html-server adapters): one small server
// that sends the site as it is, adds the panel to every HTML page it sends (the files on disk only carry data-dm
// tags), updates the page's styles live when only styles changed (anything else gets a Reload button in the panel,
// never a forced reload), and answers /__inspector/* with the core. Run it with Node 23.6 or newer:
//
//   node .inspector/tool/server/serve.ts            (from the site's folder)   [--port 5310]
//
// The site's first page can have any name (coffee-shop.html) and can sit in public/ or a similar folder. A site with
// its own small server (a server.js with a form endpoint, or a package.json start script) keeps it: this starts that
// server on a free port and stands in front of it, so the site's own routes and forms keep working.
// A page made as a claude.ai Artifact gets a stand-in for window.claude that says its claude.ai features (shared data,
// sign-in) aren't available here, which every such page is written to handle.

import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { extname, join, normalize, relative, resolve } from "node:path";
import { htmlEntry, siteServer, staticDir } from "./adapters.ts";
import { allowRequest, handleInspector, isOwnWrite, mapCheckLine, markStale, panelTags, start, toStudio } from "./core.ts";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const args = process.argv.slice(2);
const PORT = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : process.env.PORT ?? 5310);

const ENTRY = htmlEntry(ROOT) ?? "index.html"; // the first page, relative to the site's folder
const STATIC = staticDir(ROOT); // where the pages are sent from: "" (the folder itself) or "public" and the like
const SITE = siteServer(ROOT); // the site's own server, if it has one

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

const slash = (p: string) => p.replace(/\\/g, "/");
const inStatic = (rel: string) => !STATIC || rel === STATIC || rel.startsWith(STATIC + "/");

// The file on disk an address shows (relative to the site's folder): "/" is the first page, a folder its index.html,
// and an address with no file of its own and no extension its .html file, as hosts with clean addresses serve it
// (/security is security.html on Cloudflare Pages, Netlify and Vercel): the links such a site's pages carry work here
function fileFor(urlPath: string): string {
  const p = urlPath.replace(/^\/+/, "");
  if (p === "") return ENTRY;
  const rel = slash(normalize(join(STATIC, p))).replace(/^(\.\.\/)+/, "");
  const abs = join(ROOT, rel);
  if (existsSync(abs)) return statSync(abs).isDirectory() ? `${rel.replace(/\/$/, "")}/index.html` : rel;
  const clean = rel.replace(/\/$/, "");
  return !extname(clean) && existsSync(join(ROOT, `${clean}.html`)) ? `${clean}.html` : rel;
}
// The address a file is sent at (the reverse, for stylesheets)
const urlFor = (rel: string) => "/" + (STATIC && rel.startsWith(STATIC + "/") ? rel.slice(STATIC.length + 1) : rel);

// Live updates in the page: a style-only change replaces the page's <style> blocks in place; a stylesheet change
// re-links it; anything else tells the panel the page is stale (it shows a Reload button)
const live = (page: string) => `<script>(() => {
  const page = ${JSON.stringify(page)};
  const stale = () => window.dispatchEvent(new Event("design-inspector:stale"));
  new EventSource("/__inspector/events").onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "styles") {
      if (m.file !== page) return;
      const own = [...document.querySelectorAll("style")].filter((s) => !s.closest("#design-inspector"));
      if (own.length !== m.styles.length) return stale();
      own.forEach((s, i) => { if (s.textContent !== m.styles[i]) s.textContent = m.styles[i]; });
    } else if (m.type === "css") {
      document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
        const u = new URL(l.href);
        if (u.origin === location.origin && u.pathname === m.url) { u.searchParams.set("v", String(Date.now())); l.href = u.href; }
      });
    } else if (m.type === "stale") stale();
  };
})();</script>
`;

// A page made as a claude.ai Artifact reaches its features through window.claude. Here there's no claude.ai, so
// claude.use(…) answers null, the "not available in this view" every such page handles, and the page still draws.
const ARTIFACT = /\bclaude\.(use|artifact|self)\b|window\.claude\b/;
const ARTIFACT_STANDIN =
  `<script>if (!window.claude) { window.claude = { use: async () => null }; ` +
  `console.info("uberdesigner studio: this page was made as a claude.ai Artifact. Its claude.ai features (shared data, sign-in, asking Claude) are off on localhost; they work again once it's published."); }</script>`;

// A page written as a claude.ai Artifact has no doctype, <html> or <head>: claude.ai adds them when it publishes. The
// same skeleton is added here as the page is sent (the file stays as it is, so publishing it again gives the same page);
// without it the browser would draw the page in quirks mode.
const SKELETON = `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n`;
const isFragment = (html: string) => !/^\s*(<!--[\s\S]*?-->\s*)*(<!doctype|<html\b)/i.test(html);

function inject(html: string, page: string) {
  let out = isFragment(html) ? SKELETON + html : html;
  if (ARTIFACT.test(out)) {
    // Before the page's own scripts: right after <head>, or after the skeleton's meta tags
    const head = out.match(/<head\b[^>]*>/i) ?? out.match(/<html\b[^>]*>/i);
    out = head ? out.replace(head[0], head[0] + ARTIFACT_STANDIN) : out.startsWith(SKELETON) ? SKELETON + ARTIFACT_STANDIN + "\n" + out.slice(SKELETON.length) : ARTIFACT_STANDIN + out;
  }
  const tags = panelTags() + live(page);
  return /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tags}</body>`) : out + tags;
}

// What each HTML page looked like last, to tell a style-only change from one that needs a reload
const STYLE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const known = new Map<string, string>();
const remember = (rel: string, text: string) => known.set(rel, text);
const stylesOf = (text: string) => [...text.matchAll(STYLE)].map((m) => m[2]);
const withoutStyles = (text: string) => text.replace(STYLE, "$1$3");

// --- The site's own server, when it has one: started on a free port, restarted when its code changes

let sitePort = 0;
let site: ChildProcess | null = null;
let siteOutput: string[] = [];

const freePort = () =>
  new Promise<number>((done, fail) => {
    const s = createNetServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });

async function startSite() {
  if (!SITE) return;
  sitePort ||= await freePort();
  const child = spawn(SITE.command, SITE.args, { cwd: ROOT, env: { ...process.env, PORT: String(sitePort) }, stdio: ["ignore", "pipe", "pipe"] });
  site = child;
  const take = (d: Buffer) => {
    for (const line of String(d).split("\n").filter((l) => l.trim())) {
      siteOutput = [...siteOutput, line].slice(-8);
      // A server that ignores PORT says where it listens; follow it
      const at = line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)/);
      if (at && Number(at[1]) !== PORT) sitePort = Number(at[1]);
      console.log(`  site │ ${line}`);
    }
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  child.on("exit", (code, signal) => {
    if (site === child) site = null;
    if (signal !== "SIGTERM") console.warn(`  site │ ${SITE.label} stopped (${signal ?? `exit ${code}`}); it starts again when its code changes`);
  });
}

async function restartSite() {
  const old = site;
  site = null;
  if (old && old.exitCode === null) {
    await new Promise<void>((done) => {
      old.once("exit", () => done());
      old.kill("SIGTERM");
      setTimeout(() => (old.exitCode === null ? old.kill("SIGKILL") : null), 3000);
    });
  }
  await startSite();
}

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    site?.kill("SIGTERM");
    process.exit(0);
  });
process.on("exit", () => site?.kill("SIGTERM"));

// Send a request on to the site's server; its HTML pages come back with the panel added. While the server is still
// starting, the request waits a little; a server that never answers gets a page saying so, with its last output.
function forward(req: IncomingMessage, res: ServerResponse, body: Buffer, tries = 0) {
  const headers = { ...req.headers, host: `127.0.0.1:${sitePort}`, "accept-encoding": "identity" };
  const up = request({ host: "127.0.0.1", port: sitePort, method: req.method, path: req.url, headers }, (r) => {
    const type = String(r.headers["content-type"] ?? "");
    if (!type.includes("text/html")) {
      res.writeHead(r.statusCode ?? 502, r.headers);
      return void r.pipe(res);
    }
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => {
      const page = fileFor(decodeURIComponent((req.url ?? "/").split("?")[0]));
      if (existsSync(join(ROOT, page))) remember(page, readFileSync(join(ROOT, page), "utf8"));
      const out = { ...r.headers, "cache-control": "no-store" };
      delete out["content-length"];
      delete out["content-encoding"];
      res.writeHead(r.statusCode ?? 200, out);
      res.end(inject(Buffer.concat(chunks).toString("utf8"), page));
    });
  });
  up.on("error", (e: NodeJS.ErrnoException) => {
    if ((e.code === "ECONNREFUSED" || e.code === "ECONNRESET") && tries < 50) return void setTimeout(() => forward(req, res, body, tries + 1), 200);
    if (res.headersSent) return void res.end();
    res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
    res.end(
      `<!doctype html><meta charset="utf-8"><title>The site's server isn't answering</title><body style="font:15px/1.5 system-ui;padding:40px;max-width:720px">` +
        `<h1 style="font-size:20px">The site's own server isn't answering</h1><p>uberdesigner studio started <code>${esc(SITE?.label ?? "")}</code> ` +
        `on port ${sitePort}, and it didn't answer (${esc(e.code ?? e.message)}). Its last output:</p>` +
        `<pre style="background:#f3f3f3;padding:12px;white-space:pre-wrap">${esc(siteOutput.join("\n") || "(nothing)")}</pre>` +
        `<p>It starts again when its code changes. Reload this page to try again.</p>${panelTags()}${live(fileFor("/"))}</body>`,
    );
  });
  up.end(body);
}

// --- Live updates: one stream per open page, told when a site file changes (not the inspector's own folder)

const listeners = new Set<(event: object) => void>();
const changed = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const broadcast = (event: object) => listeners.forEach((send) => send(event));
watch(ROOT, { recursive: true }, (_e, name) => {
  const rel = slash(String(name ?? ""));
  // The map is the inspector's own file: the server writes it after changes, and it's never part of the page
  if (!rel || /^(\.inspector|\.git|node_modules)(\/|$)/.test(rel) || rel === "inspector.map.json") return;
  changed.add(rel);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const files = [...changed];
    changed.clear();
    const needReload: string[] = [];
    let restart = false;
    for (const f of files) {
      const abs = join(ROOT, f);
      if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
      if (SITE && !inStatic(f)) {
        // Outside the pages' folder: the server's own code restarts it; its data files (saved form replies) don't count
        if (/\.(m?js|cjs|ts)$/.test(f)) {
          restart = true;
          needReload.push(f);
        }
      } else if (/\.css$/.test(f)) broadcast({ type: "css", url: urlFor(f) });
      else if (/\.html?$/.test(f)) {
        const now = readFileSync(abs, "utf8");
        const before = known.get(f);
        remember(f, now);
        if (before !== undefined && withoutStyles(before) === withoutStyles(now)) broadcast({ type: "styles", file: f, styles: stylesOf(now) });
        else if (before !== now && !isOwnWrite(f)) needReload.push(f); // words typed over the page are already on it
      } else if (!isOwnWrite(f)) needReload.push(f);
    }
    const tell = () => {
      if (!needReload.length) return;
      markStale(needReload);
      broadcast({ type: "stale", files: needReload });
    };
    if (restart) void restartSite().then(tell);
    else tell();
  }, 150);
});

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);

  if (url === "/__inspector/events") {
    if (!allowRequest(req, res)) return;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n");
    const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    listeners.add(send);
    req.on("close", () => listeners.delete(send));
    return;
  }
  if (url.startsWith("/__inspector/")) return void handleInspector(req, res, () => res.writeHead(404).end());
  if (toStudio(req, res)) return; // a person opening a page of the site: the studio, on that page

  // A site with its own server: everything else goes to it
  if (SITE) {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => forward(req, res, Buffer.concat(chunks)));
    return;
  }

  // The site's own files
  const rel = fileFor(url);
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || /[/\\]\.inspector([/\\]|$)/.test(file)) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  if (type.startsWith("text/html")) {
    const text = readFileSync(file, "utf8");
    remember(slash(relative(ROOT, file)), text);
    return void res.end(inject(text, slash(relative(ROOT, file))));
  }
  res.end(readFileSync(file));
});

start();
server.listen(PORT, "127.0.0.1", async () => {
  console.log(`uberdesigner studio: serving ${ROOT}${ENTRY !== "index.html" ? ` (first page: ${ENTRY})` : ""}`);
  if (SITE) {
    await startSite();
    console.log(`  with the site's own server: ${SITE.label}, on port ${sitePort}, behind the studio`);
  }
  console.log(`  open http://localhost:${PORT}/ : the site opens in the studio`);
  const behind = mapCheckLine();
  if (behind) console.warn(behind);
});
