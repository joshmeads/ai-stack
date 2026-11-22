import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// What the core needs to know about a site's stack. Everything stack-neutral (changes, history, Claude Code runs,
// context, the API) lives in the modules core.ts lists; an adapter only says how this kind of site is checked, whether it takes
// packages, and how the panel attaches. A new stack is a new entry here plus its attach (see vite-plugin.ts, serve.ts).

export type StackId = "vite-react" | "html-static" | "html-server";

export type Adapter = {
  id: StackId;
  label: string;
  packages: boolean; // can a change install npm packages?
  check: "tsc" | "syntax"; // what runs after a change: the typecheck, or a syntax check of the scripts
  attach: "vite-plugin" | "standalone"; // how the panel reaches the page
  hotUpdates: boolean; // the dev server swaps changed modules into the open page; whether code already running took the change can't be told
  start: string; // what the person runs to open the site with the inspector
};

const ADAPTERS: Record<StackId, Adapter> = {
  "vite-react": {
    id: "vite-react",
    label: "Vite + React",
    packages: true,
    check: "tsc",
    attach: "vite-plugin",
    hotUpdates: true,
    start: "pnpm dev (or npm run dev)",
  },
  "html-static": {
    id: "html-static",
    label: "HTML, no build step",
    packages: false,
    check: "syntax",
    attach: "standalone",
    hotUpdates: false,
    start: "node .inspector/tool/server/serve.ts",
  },
  // Plain HTML pages that the site's own small server sends (a Node server with a form endpoint, say): serve.ts runs
  // that server and stands in front of it, so the forms keep working while the inspector adds its panel
  "html-server": {
    id: "html-server",
    label: "HTML with its own small server",
    packages: true,
    check: "syntax",
    attach: "standalone",
    hotUpdates: false,
    start: "node .inspector/tool/server/serve.ts",
  },
};

// Packages that mean the site has a build step of its own (none of them is a plain HTML site)
const BUILD_TOOLS = ["vite", "react-scripts", "next", "astro", "nuxt", "gatsby", "parcel", "webpack", "@sveltejs/kit", "@remix-run/dev", "@11ty/eleventy"];
// Folders a small server commonly sends its pages from
const STATIC_DIRS = ["", "public", "static", "www", "site"];

type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
const readPkg = (root: string): Pkg | null => {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Pkg;
  } catch {
    return null;
  }
};
const deps = (p: Pkg | null) => ({ ...p?.dependencies, ...p?.devDependencies });
const hasBuildTool = (root: string) => existsSync(join(root, "package.json")) && BUILD_TOOLS.some((t) => t in deps(readPkg(root)));

// A plain HTML site's first page, relative to the site's folder: index.html at the top, else the one page there (an
// AI builder often names it after the site: coffee-shop.html), else the biggest page there; then the same in a folder
// a small server sends its pages from (public/, static/…). Null when there's no page, or the site has a build step.
export function htmlEntry(root: string): string | null {
  if (hasBuildTool(root)) return null;
  for (const sub of STATIC_DIRS) {
    const dir = join(root, sub);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    if (existsSync(join(dir, "index.html"))) return sub ? `${sub}/index.html` : "index.html";
    const pages = readdirSync(dir)
      .filter((f) => /\.html?$/i.test(f))
      .map((f) => ({ f, size: statSync(join(dir, f)).size }))
      .sort((a, b) => b.size - a.size);
    if (pages.length) return sub ? `${sub}/${pages[0].f}` : pages[0].f;
  }
  return null;
}

// The site's own server, when it has one: the package's start (or dev) script, else a server file at the top that
// listens on a port. Null for a site that's only files.
export function siteServer(root: string): { command: string; args: string[]; label: string } | null {
  const pkg = readPkg(root);
  for (const name of ["start", "dev", "serve"]) {
    const script = pkg?.scripts?.[name];
    if (script && !/\b(vite|next|astro|webpack|parcel|serve\b|http-server|live-server)\b/.test(script))
      return { command: "npm", args: ["run", name], label: `npm run ${name}` };
  }
  for (const f of ["server.js", "server.mjs", "server.cjs", "app.js", "index.js", "main.js", "server.ts"]) {
    const file = join(root, f);
    if (existsSync(file) && /\.listen\s*\(/.test(readFileSync(file, "utf8"))) return { command: process.execPath, args: [f], label: `node ${f}` };
  }
  return null;
}

// Where the site's pages are served from, relative to its folder ("" for the folder itself)
export const staticDir = (root: string) => {
  const entry = htmlEntry(root);
  return entry && entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/")) : "";
};

// Frameworks the inspector has no connector for yet, by the package that gives them away. Checked before Vite: most of
// them run on Vite underneath, or sit next to it (a Next.js site with Vite installed for its tests).
const FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["astro", "Astro"],
  ["@sveltejs/kit", "SvelteKit"],
  ["@remix-run/dev", "Remix"],
  ["@react-router/dev", "React Router (framework mode)"],
  ["gatsby", "Gatsby"],
  ["@11ty/eleventy", "Eleventy"],
  ["react-scripts", "Create React App"],
  ["@angular/core", "Angular"],
];
// Other bundlers, when the site isn't a Vite one
const BUNDLERS: [string, string][] = [
  ["parcel", "Parcel"],
  ["webpack", "webpack"],
];
const VITE_WITHOUT_REACT: [string, string][] = [
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["solid-js", "Solid"],
  ["preact", "Preact"],
  ["lit", "Lit"],
];
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];

// Whether the design-map scripts can set this site up, said before anything is read or written. The scripts ask this
// (scripts/lib.mjs requireSupported); detectStack below stays forgiving for a site that already has the inspector.
// Supported: Vite + React (a vite config and React among the packages), and sites with no build step (an HTML page).
export function stackSupport(root: string): { ok: true; adapter: Adapter } | { ok: false; found: string; why: string } {
  const pkg = readPkg(root);
  const d = deps(pkg);
  const framework = FRAMEWORKS.find(([name]) => name in d);
  if (framework) return { ok: false, found: framework[1], why: `this is a ${framework[1]} site (package "${framework[0]}")` };
  if ("vite" in d) {
    if (!("react" in d)) {
      const other = VITE_WITHOUT_REACT.find(([name]) => name in d);
      return { ok: false, found: other ? `Vite + ${other[1]}` : "Vite without React", why: other ? `this is a Vite + ${other[1]} site` : "this Vite site doesn't use React" };
    }
    if (!VITE_CONFIGS.some((f) => existsSync(join(root, f)))) return { ok: false, found: "Vite + React, no config", why: "there's no vite.config file in this folder for uberdesigner studio to load from (is this the site's own folder?)" };
    return { ok: true, adapter: ADAPTERS["vite-react"] };
  }
  const bundler = BUNDLERS.find(([name]) => name in d);
  if (bundler) return { ok: false, found: bundler[1], why: `this site is built with ${bundler[1]} (package "${bundler[0]}")` };
  if (htmlEntry(root)) return { ok: true, adapter: siteServer(root) ? ADAPTERS["html-server"] : ADAPTERS["html-static"] };
  if (pkg) return { ok: false, found: "a package.json with no known build tool", why: "it has a package.json but no Vite, and no HTML page at its top or in public/, static/, www/ or site/" };
  return { ok: false, found: "no site", why: "there's no package.json and no HTML page here" };
}

export function detectStack(root: string): Adapter {
  const pkg = join(root, "package.json");
  if (existsSync(pkg) && "vite" in deps(readPkg(root))) return ADAPTERS["vite-react"];
  if (htmlEntry(root)) return siteServer(root) ? ADAPTERS["html-server"] : ADAPTERS["html-static"];
  // Unknown stacks get the closest behaviour: packages and a typecheck when there's a package.json and tsconfig
  return existsSync(pkg) ? ADAPTERS["vite-react"] : ADAPTERS["html-static"];
}
