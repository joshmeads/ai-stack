// The site's pages, as far as its open pages tell: each page the frame has shown, and the pages their links go to
// (same site, not a file to download, not the studio's own). Stack-neutral: a plain HTML site's .html files and a
// React site's routes are found the same way, by the links a visitor would follow. A page nothing links to is
// listed once it has been opened. The Pages tab shows only when this finds more than one.

export type SitePage = { path: string; label: string; named: boolean }; // named: the label is a link's words

const MAX_PAGES = 200;
const MAX_LABEL = 40;
const HOME: SitePage = { path: "/", label: "Home", named: true };
const FILE = /\.(?!html?$)[a-z0-9]{1,5}$/i; // a file, not a page: .pdf, .jpg, .zip…

// One address per page: /about/index.html and /about/ are one page, a #section on it is the same page
export const pagePath = (url: URL) => url.pathname.replace(/\/index\.html?$/i, "/") + url.search;

// A label from the address when no link names the page: "/" is Home, "/our-work.html" is Our work
function fromPath(path: string): string {
  const last = path.split("?")[0].replace(/\/+$/, "").split("/").pop() ?? "";
  const words = decodeURIComponent(last).replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Home";
}

function readPages(doc: Document): SitePage[] {
  const win = doc.defaultView;
  if (!win) return [];
  const origin = win.location.origin;
  const found = new Map<string, SitePage>();
  const here = pagePath(new URL(win.location.href));
  found.set("/", HOME); // every site has a first page; it is Home whatever its links call it (the logo, "Agents")
  if (here !== "/") found.set(here, { path: here, label: fromPath(here), named: false });
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (found.size >= MAX_PAGES) break;
    let url: URL;
    try {
      url = new URL(a.getAttribute("href") ?? "", doc.baseURI);
    } catch {
      continue;
    }
    if (url.origin !== origin || !/^https?:$/.test(url.protocol) || url.pathname.startsWith("/__inspector") || FILE.test(url.pathname) || a.hasAttribute("download")) continue;
    const path = pagePath(url);
    if (path === here || path === "/") continue; // a link to this page itself ("Skip to content", the logo) doesn't name it
    const words = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    const named = words.length > 0 && words.length <= MAX_LABEL;
    const was = found.get(path);
    if (!was) found.set(path, { path, label: named ? words : fromPath(path), named });
    else if (!was.named && named) found.set(path, { path, label: words, named });
  }
  return [...found.values()];
}

// The pages found before, with the ones the page just loaded tells of: a page keeps its place in the list, and gets a
// link's words for its label once a link names it. Home first.
export function mergePages(before: SitePage[], doc: Document): SitePage[] {
  const out = new Map(before.map((p) => [p.path, p]));
  for (const p of readPages(doc)) {
    const was = out.get(p.path);
    if (!was || (!was.named && p.named)) out.set(p.path, was ? { ...was, label: p.label, named: true } : p);
  }
  const list = [...out.values()].slice(0, MAX_PAGES);
  const home = list.findIndex((p) => p.path === "/");
  if (home > 0) list.unshift(...list.splice(home, 1));
  return list;
}
