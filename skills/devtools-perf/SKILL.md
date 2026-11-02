---
name: devtools-perf
description: Measure CPU and memory per user action or per request path, in the browser and on a Node server (Next.js included), with a zero-dependency Chrome DevTools Protocol CLI. Use when asked to profile, optimise or find leaks in a web app's CPU or memory, to say which function or route costs the most, or to check whether a change made an action cheaper.
---

# devtools-perf

`scripts/cdt.mjs` brackets each action with forced GC and samples, then prints per action:

- **Browser.** Main-thread time split into script, layout and style, CPU per Chrome process (renderer, GPU, browser), JS heap grown and retained after GC, DOM node and listener deltas, long tasks, and the network requests the action caused.
- **Each Node server** (`--node`). Process CPU (user and system), heap grown and retained after GC, external memory, RSS.
- **Per function, for every target.** Top self time, plus "app total" and "app self", which keep only your source (not `node_modules`, the bundler runtime or Node internals). Frames resolve through source maps, so minified production code shows `slowRenderWork app/page.js:3`.
- **Leaks.** With `--repeat N`, heap after GC per iteration and the steady growth per iteration.

Full results go to `<out>/summary.json` and `results.jsonl`. A `.cpuprofile` per target per step opens in DevTools (Performance panel, or Node DevTools for server profiles). Run `node scripts/cdt.mjs --help` for every flag.

Needs Node 22 or later. Chrome and the measured server must run outside the agent's command sandbox. If a launch or connect fails with a timeout or "Operation not permitted", rerun unsandboxed.

## Next.js

1. Build and serve a profiling build. Measure production when the question is real cost. Use `next dev --inspect` when you only need readable names quickly, but dev adds compile cost and React dev-mode overhead.

   ```sh
   node scripts/cdt.mjs next build --dir <app>                 # source maps forced on, output in .next/cdt-profile
   node scripts/cdt.mjs next start --dir <app> -- -p 3000      # long-running: start it in the background; adds --inspect
   node scripts/cdt.mjs node-targets                           # confirm the inspector port (default 9229)
   ```

   `cdt next` preloads `next-sourcemaps-hook.cjs`, which turns on `productionBrowserSourceMaps` and `experimental.serverSourceMaps` and sets `distDir` inside Next's in-memory config, whatever the app's `next.config` says. `next.config` is never edited, the app's own `.next` build is left alone, and `tsconfig.json` and `next-env.d.ts` (which `next build` rewrites) are restored byte for byte afterwards. If the hook prints that the config loader is not recognised, the Next version moved `loadConfig`. Fall back to `next build && next start --inspect` and accept minified browser names.

   Next 16 runs `next start` and the `next dev` server as one inspectable process. If `node-targets` lists several processes, pass the one whose argv contains `start-server` or `next start`, or pass `--node auto` to measure all of them.

2. Per request path, with no browser needed:

   ```json
   [
     { "label": "GET /", "action": ["request", "http://localhost:3000/"] },
     { "label": "GET /api/items", "action": ["request", "http://localhost:3000/api/items"] },
     { "label": "POST /api/items", "action": ["request", "POST", "http://localhost:3000/api/items", "{\"name\":\"x\"}"] }
   ]
   ```

   ```sh
   node scripts/cdt.mjs flow routes.json --node 9229 --repeat 5 --settle 100
   ```

3. Per user action, browser and server together:

   ```sh
   node scripts/cdt.mjs launch http://localhost:3000/ --headless
   node scripts/cdt.mjs flow ui.json --port 9222 --node 9229 --repeat 3
   ```

   Here `ui.json` steps use `goto`, `click`, `type`, `press` and `eval`. Each step lists the requests it caused, which ties the server cost in that step to the route paths.

4. The minifier inlines small functions. An inlined function is reported at its call site's line and named after the original function, so the line can point at the caller.

## Reading the numbers

- Treat iteration 1 as warm-up. It carries JIT, module loading and, in dev, compilation. Compare iterations 2 and later.
- **"grew" vs "retained".** "Grew" is allocation pressure during the step (GC churn, CPU). "Retained" is what survived a forced GC. Steady retained growth across repeats is a leak. One-off retained memory after iteration 1 is usually a cache filling.
- When a step navigates, Chrome resets per-document counters. The tool then reports the new document's totals and prints `navigated:`.
- Server CPU covers the whole process during the step. Measure one step at a time against an otherwise idle server, or attribution blurs. Do not run load tests through `measure` and then read per-route numbers.
- Sampling is every 100µs (browser) or 200µs (Node). Functions under ~1ms are noise. Use `--repeat` and compare medians before you claim a win.
- Reach for `--throttle 4` to make browser CPU differences visible on a fast Mac.

## Going deeper

- Follow up a suspected leak with `--heap-snapshots`. It writes before and after `.heapsnapshot` files per target. Diff them in DevTools (Memory panel, Comparison view). If chrome-devtools-mcp is installed with `--memoryDebugging=true`, use its `compare_heapsnapshots` and `get_heapsnapshot_retaining_paths`.
- When you need a frame-by-frame view of the browser (rendering, paint, GPU), use `--trace`. It writes a trace you can load in the Performance panel.
- When another tool drives the app (Playwright, a k6 script), use `run "<cmd>"` as the action so it is measured as one step.
- `--filter STR` restricts the app lists to sources containing STR, such as `app/dashboard` or `lib/db`.

## Report

For each action or route, state CPU (server and browser main thread), retained memory, and the top 3 app functions, with the iteration count and whether the build was dev or prod. For a before and after comparison, run both on the same build mode, with the same `--repeat` and throttle, and quote the artifact directory.
