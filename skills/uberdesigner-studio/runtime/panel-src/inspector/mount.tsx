import { createRoot } from "react-dom/client";
import { Editor } from "./Editor";
import { EDITOR_PATH, isEditor, isFramedByEditor } from "./site";
import { applyTheme } from "./theme";

// The dev server adds the studio's bundle to every page it serves (server/api.ts panelTags), and to its own editor
// page (/__inspector/editor). It looks where it is:
// - the editor page: the whole editor (the site in a frame, the request bar, the columns);
// - a site page inside the editor's frame: nothing (the editor around it reads and outlines it);
// - a site page on its own: the studio is where the site opens, so the tab goes to the editor on this page. The
//   server already sends a browser there before the page loads (api.ts toStudio); this is for what gets past it (a
//   browser that doesn't say what it is loading, a page a single-page site routed to by itself). With the studio
//   switched off for this browser (?studio=off), and in someone else's frame, the page is left as the site alone.

const studioOff = () => /(?:^|;\s*)uberdesigner_studio=off/.test(document.cookie);

export function mountInspector() {
  if (document.getElementById("design-inspector") || isFramedByEditor()) return;
  if (!isEditor()) {
    if (window !== window.parent || studioOff()) return;
    location.replace(`${EDITOR_PATH}?${new URLSearchParams({ path: location.pathname + location.search + location.hash })}`);
    return;
  }
  applyTheme(); // light or dark, before anything is drawn (theme.ts)
  const host = document.createElement("div");
  host.id = "design-inspector";
  document.body.appendChild(host);
  createRoot(host).render(<Editor />);
}
