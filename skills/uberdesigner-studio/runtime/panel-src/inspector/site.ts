// Where the site is. A site page opened on its own goes to the editor (mount.tsx; the server sends it first); the
// editor (/__inspector/editor) shows the site in a frame between its columns. Everything that touches the site's
// page (outlines, live token edits, Replay, the stale signal) goes through here, so it reaches the frame in the editor
// and the page itself elsewhere.

export const EDITOR_PATH = "/__inspector/editor";

export const isEditor = () => location.pathname === EDITOR_PATH;

// A page shown inside the editor's frame: the editor around it draws everything, so it shows nothing of its own
export function isFramedByEditor(): boolean {
  if (window === window.parent) return false;
  try {
    return window.parent.location.pathname === EDITOR_PATH;
  } catch {
    return false; // framed by another origin: not ours
  }
}

type Site = { win: Window; doc: Document; reload: () => void };
const here: Site = { win: window, doc: document, reload: () => location.reload() };
let current: Site = here;

export const site = () => current;

// The editor points this at its frame each time the frame loads
export function pointAtFrame(frame: HTMLIFrameElement | null) {
  const win = frame?.contentWindow;
  const doc = frame?.contentDocument;
  current = win && doc ? { win, doc, reload: () => win.location.reload() } : here;
}

// Replay the page (intro and load-time motion) or show a change that couldn't apply live
export const reloadSite = () => current.reload();

// Reload to show a change, staying where the page is scrolled: the person is looking at what changed, and a reload
// (or the site's own intro) would drop them at the top. The editor puts the page back once it has loaded.
let scrollBack: number | null = null;
export function reloadInPlace() {
  scrollBack = current.win.scrollY;
  current.reload();
}
export const takeScrollBack = () => {
  const y = scrollBack;
  scrollBack = null;
  return y;
};

// Open the editor on the page that's showing, optionally with a part picked
export function openEditor(partId?: string | null) {
  const path = location.pathname + location.search + location.hash;
  const q = new URLSearchParams({ path });
  if (partId) q.set("part", partId);
  location.href = `${EDITOR_PATH}?${q}`;
}
