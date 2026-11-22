import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The inspector panel as one self-contained script (React included) plus one stylesheet, the same for every stack.
// The dev server serves runtime/panel/ and puts the project's map on the page as window.__DESIGN_MAP__.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "runtime/panel",
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: fileURLToPath(new URL("./runtime/panel-src/entry.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "inspector.js",
      cssFileName: "inspector",
    },
  },
});
