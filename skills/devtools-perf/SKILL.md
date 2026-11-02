---
name: devtools-perf
description: Measure CPU and memory per user action or per request path, in the browser and on a Node server (Next.js included), with a zero-dependency Chrome DevTools Protocol CLI. Use when asked to profile, optimise or find leaks in a web app's CPU or memory, to say which function or route costs the most, or to check whether a change made an action cheaper.
---

# devtools-perf

`scripts/cdt.mjs` brackets each action with forced GC and samples on every target, then prints per action:

- **Browser.** Main-thread time split into script, layout and style, CPU per Chrome process (renderer, GPU, browser), JS heap allocated and retained after GC, DOM node and listener deltas, long tasks (50ms or more), and the network requests the action caused.
- **Each Node server** (`--node`). Process CPU (user and system), heap allocated and retained after GC, external memory, RSS.
- **Per function, for every target.** Top self time, plus "app total" and "app self", which keep only your source (not `node_modules`, the bundler runtime or Node internals), and the functions that allocated most. Frames resolve through source maps, so minified production code shows `slowRenderWork app/page.js:3`. A `source maps:` line says what share of time in non-library scripts resolved and which scripts had no map. Unmapped bundle chunks (`/_next/`, `.next/`) are left out of the app lists, so a low share means the app lists are incomplete.
- **Leaks.** With `--repeat N`, heap (and in the browser, DOM nodes and listeners) after GC at the end of each iteration, with the per-iteration trend.

The first output line names the results directory: a new folder under the system temp dir, or `--out DIR`, which must be new or empty. It holds `summary.json`, `results.jsonl`, and per target per step a `.cpuprofile` and a `.heapprofile` (open both in DevTools). cdt exits non-zero when a step fails or a target disconnects. Run `node scripts/cdt.mjs --help` for every flag.

Needs Node 22 or later; `cdt next` needs 22.15+ or 23.5+. Chrome and the measured server must run outside the agent's command sandbox. If a launch or connect fails with a timeout or "Operation not permitted", rerun unsandboxed.

## Next.js

1. Build and serve a profiling build. Measure production when the question is real cost. Use `next dev --inspect` when you only need readable names quickly, but dev adds compile cost and React dev-mode overhead.

   ```sh
   node scripts/cdt.mjs next build --dir <app>                 # source maps forced on, output in .next/cdt-profile
   node scripts/cdt.mjs next start --dir <app> -- -p 3000      # long-running: start it in the background; adds --inspect
   node scripts/cdt.mjs node-targets                           # confirm the inspector port (default 9229)
   ```

   `cdt next` preloads `next-sourcemaps-hook.cjs`, which turns on `productionBrowserSourceMaps` and `experimental.serverSourceMaps` and sets `distDir` inside Next's in-memory config. `next.config` is never edited and the app's own `.next` build is never written. It fails closed:
   - It refuses before building when the Next version's config loader is not one it recognises, and refuses `output: 'export'`, which writes to `.next` whatever `distDir` says. Fall back to `next build && next start --inspect` and accept minified browser names.
   - After a build it checks that the app's `.next/BUILD_ID` is unchanged and a fresh `.next/cdt-profile/BUILD_ID` exists, or exits non-zero.
   - `next build` points `tsconfig.json` (or `typescript.tsconfigPath`) and `next-env.d.ts` at `.next/cdt-profile`. cdt undoes exactly those edits, deleting the file if it did not exist before. In a git repo it also checks `git status` and undoes other files that now mention `cdt-profile`. Any other change made during the build is reported and left alone.
   - `next start` changes nothing and restores nothing. It needs a profiling build first and stops the server if the hook cannot confirm the redirect.

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
   node scripts/cdt.mjs flow ui.json --port 9222 --node 9229 --repeat 4
   ```

   Here `ui.json` steps use `goto`, `click`, `type`, `press` and `eval`. Each step lists the requests it caused, which ties the server cost in that step to the route paths.

4. The minifier inlines small functions. An inlined function is reported at its call site's line and named after the original function, so the line can point at the caller.

## Reading the numbers

- **Two passes.** The CPU and allocation profilers run by default, and every CPU figure includes their overhead (a profiled click measured about 80ms of renderer CPU against 47ms unprofiled, and an idle server 17ms against 4ms). Use the default pass for function lists, allocations and long tasks. Take CPU numbers from a second pass with `--no-profile`.
- Treat iteration 1 as warm-up. It carries JIT, module loading and, in dev, compilation. Compare iterations 2 and later.
- **"allocated" vs "retained".** "Allocated" is the bytes the step allocated, including objects already collected. It is a sampled estimate, rough below a few hundred KB. "Retained" is what survived a forced GC. Steady retained growth across repeats is a leak. One-off retained memory after iteration 1 is usually a cache filling.
- **Leak trend.** The trend is a least-squares slope over iterations 2 and later, so use `--repeat 4` or more, and make the flow end in the same state each iteration (for example, start it with a `goto`).
- **Navigations.** When a step loads a new document, Chrome restarts its main-thread counters, so those figures cover the new document only. Heap and DOM are then shown as totals after GC rather than deltas. `cdt launch` turns off the back/forward cache, which would otherwise keep the old page alive in the heap. With your own Chrome, expect that.
- Long tasks come from a light trace that runs with the profilers. A step with none prints `none`. With `--no-profile` it prints `not observed`.
- Server CPU covers the whole process during the step. Measure one step at a time against an otherwise idle server, or attribution blurs. Do not run load tests through `measure` and then read per-route numbers.
- CPU sampling is every 100µs (browser) or 200µs (Node). Functions under ~1ms are noise. Use `--repeat` and compare medians before you claim a win.
- Reach for `--throttle 4` to make browser CPU differences visible on a fast Mac.
- A step that waits on something that never comes (a load event, a promise, a `run` command) fails after `--action-timeout` (default 5 minutes), and a silent target after `--cdp-timeout` (default 60s). Raise either for slow work, or pass 0 to wait forever.

## Going deeper

- Follow up a suspected leak with `--heap-snapshots`. It writes before and after `.heapsnapshot` files per target, streamed to disk. Diff them in DevTools (Memory panel, Comparison view). If chrome-devtools-mcp is installed with `--memoryDebugging=true`, use its `compare_heapsnapshots` and `get_heapsnapshot_retaining_paths`.
- When you need a frame-by-frame view of the browser (rendering, paint, GPU), use `--trace`. It writes a trace you can load in the Performance panel. It adds a second JS sampler, so read pictures from it, not numbers.
- When another tool drives the app (Playwright, a k6 script), use `run "<cmd>"` as the action so it is measured as one step.
- `--filter STR` keeps only functions whose resolved source path contains STR, such as `app/dashboard` or `lib/db`, in the app lists. It does not change top self.

## Report

For each action or route, state CPU (server and browser main thread) from the `--no-profile` pass, allocated and retained memory, and the top 3 app functions, with the iteration count and whether the build was dev or prod. For a before and after comparison, run both on the same build mode, with the same `--repeat` and throttle, and quote the results directory.
