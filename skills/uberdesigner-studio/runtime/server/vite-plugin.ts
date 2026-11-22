import { relative } from "node:path";
import type { Plugin } from "vite";
import { handleInspector, isOwnWrite, mapCheckLine, markStale, panelTags, start } from "./core.ts";

// How the inspector attaches to a Vite project (the vite-react adapter): its API on Vite's dev server, and the panel
// added to every page Vite serves. The site's vite.config loads this from .inspector/tool/ only if it's there:
//
//   const inspector = await import(/* @vite-ignore */ "./.inspector/tool/server/vite-plugin.ts")
//     .then((m) => m.inspector()).catch(() => null);
//   export default defineConfig({ plugins: [react(), inspector] });
//
// so a fresh clone without .inspector/ still builds, and nothing of the inspector reaches a production build.

export function inspector(): Plugin {
  return {
    name: "design-inspector",
    apply: "serve",
    configureServer(server) {
      server.watcher.unwatch("**/.inspector/**"); // history and work files shouldn't trigger reloads
      // Hot updates (CSS, React components) still apply live; a full page reload is never forced: the panel shows a
      // Reload button instead, so the page doesn't restart under the person while they compare or type
      const hot = server.environments?.client?.hot ?? server.ws;
      const send = hot.send.bind(hot) as (...args: unknown[]) => void;
      hot.send = ((...args: unknown[]) => {
        const p = args[0] as { type?: string; triggeredBy?: string; path?: string } | string | undefined;
        if (p && typeof p === "object" && p.type === "full-reload") {
          const file = p.triggeredBy ? relative(server.config.root, p.triggeredBy) : (p.path ?? "the page");
          if (!isOwnWrite(file)) markStale([file]); // words typed over the page are already on it
          return;
        }
        send(...args);
      }) as typeof hot.send;
      start();
      server.middlewares.use((req, res, next) => void handleInspector(req, res, next));
      // Said once when the dev server starts: the map has fallen behind the site (the panel says it too)
      server.httpServer?.once("listening", () => {
        const behind = mapCheckLine();
        if (behind) server.config.logger.warn(behind);
      });
    },
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${panelTags()}</body>`),
    },
  };
}
