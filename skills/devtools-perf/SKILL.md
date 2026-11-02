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

Needs Node 22 or later; `cdt next` needs 22.15+ or 23.5+. Chrome and the measured server must run outside the agent's command sandbox. If a launch or connect fails with a timeout or "Operation not permitted", rerun unsandboxed. Tests for `cdt next` (no dependencies): `node --test scripts/test/`.

## Next.js

1. Build and serve a profiling build. Measure production when the question is real cost. Use `next dev --inspect` when you only need readable names quickly, but dev adds compile cost and React dev-mode overhead.

   ```sh
   node scripts/cdt.mjs next build --dir <app>                 # source maps forced on, output in <distDir>/cdt-profile
   node scripts/cdt.mjs next start --dir <app> -- -p 3000      # long-running: start it in the background; adds --inspect
   node scripts/cdt.mjs node-targets                           # confirm the inspector port (default 9229)
   ```

   `cdt next` preloads `next-sourcemaps-hook.cjs`, which turns on `productionBrowserSourceMaps` and `experimental.serverSourceMaps` and sets `distDir` to `<your distDir>/cdt-profile` (`.next/cdt-profile` by default) inside Next's in-memory config. `next.config` is never edited and your own build is never written. Pass the app folder with `--dir`, not as an argument after `--`. It fails closed:
   - It refuses before Next writes anything when Next's config loader or entry modules are not ones it recognises, wherever Next is loaded from (symlinked installs included). It also refuses `output: 'export'`, which writes to `.next` whatever `distDir` says. Fall back to `next build && next start --inspect` and accept minified browser names.
   - After a build it checks that your own `<distDir>/BUILD_ID` is unchanged and a fresh `<distDir>/cdt-profile/BUILD_ID` exists, or exits non-zero.
   - `next build` rewrites `tsconfig.json` (or `typescript.tsconfigPath`) and `next-env.d.ts`. The hook records the bytes Next writes to each. Afterwards cdt puts the original back only where the file still holds exactly those bytes, and deletes the file if it did not exist before. A file changed again after Next wrote it is left alone and reported, and if it still mentions `cdt-profile`, cdt exits non-zero. In a git repo cdt also lists other files that changed during the build, and never reverts them.
   - `next build` often outlasts a 2-minute command timeout, so run it in the background or with a longer timeout. If cdt is killed mid-build, the next `cdt next build` first finishes the restore from the records it keeps in the system temp dir (so rerun it with the same sandbox setting). A project whose tsconfig or `next-env.d.ts` mentions `cdt-profile` without such a record is refused until you remove those entries.
   - `next start` changes nothing. It needs a profiling build first, stops the server if the hook cannot confirm the redirect, and warns when the source changed after the profiling build.

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

- **Two passes.** The CPU and allocation profilers run by default, and every CPU figure includes their overhead (a profiled click measured about 80ms of renderer CPU against 47ms unprofiled, and an idle server 17ms against 4ms). Use the default pass for function lists and allocations. Take CPU numbers and long tasks from a second pass with `--no-profile`. The default pass labels its long tasks `(with profiler on)`.
- Treat iteration 1 as warm-up. It carries JIT, module loading and, in dev, compilation. Compare iterations 2 and later.
- **"allocated" vs "retained".** "Allocated" is the bytes the step allocated, including objects already collected. It is a sampled estimate, rough below a few hundred KB. "Retained" is what survived a forced GC. Steady retained growth across repeats is a leak. One-off retained memory after iteration 1 is usually a cache filling.
- **Leak trend.** The trend is a least-squares slope over iterations 2 and later, so use `--repeat 4` or more, and make the flow end in the same state each iteration (for example, start it with a `goto`).
- **Navigations.** When a step loads a new document, Chrome restarts its main-thread counters, so those figures cover the new document only. Heap and DOM are then shown as totals after GC rather than deltas. `cdt launch` turns off the back/forward cache, which would otherwise keep the old page alive in the heap. With your own Chrome, expect that.
- **Partial profiles.** A new document can also restart the CPU and allocation profilers, and then only the new session's data comes back. cdt prints `PARTIAL profile` with how much of the step the function lists and allocated bytes cover, and marks allocated bytes `(partial)`.
- **Renderer CPU** counts only the renderer processes that hosted this page's frames during the step (`renderer = this page's`). Other renderers are listed separately, for example Chrome's spare renderer started after a cross-site navigation. A process that exits mid-step, such as the old renderer on a cross-site navigation, has no final reading, so it is listed under `exited mid-step` and not counted. When the trace cannot say which renderers are the page's, the line says `renderer = all renderers`.
- **Long tasks** come from a light task trace that runs in both passes (about 0.5ms of renderer CPU per step). `none` means the trace saw none. `incomplete (trace data lost)` means Chrome dropped trace data, so a missing long task proves nothing.
- Server CPU covers the whole process during the step. Measure one step at a time against an otherwise idle server, or attribution blurs. Do not run load tests through `measure` and then read per-route numbers.
- CPU sampling is every 100µs (browser) or 200µs (Node). Functions under ~1ms are noise. Use `--repeat` and compare medians before you claim a win.
- Reach for `--throttle 4` to make browser CPU differences visible on a fast Mac. Renderer process CPU then also includes the throttling itself (a page load measured 82ms unthrottled and 461ms at 4x, with main-thread time near 45ms in both), so compare throttled runs only with each other.
- **Timeouts.** An action that outlasts `--action-timeout` (default 5 minutes) is stopped where cdt can prove it: a `run` command and every process it started are killed, and the step fails. Work cdt cannot cancel (an `eval` promise, a click handler, a page load, a server still answering a `request`) would spill into later steps, so cdt stops the run there and writes what it has to `summary.json`. A target silent for `--cdp-timeout` (default 60s) fails the step. Raise either limit for slow work, or pass 0 to wait forever.

## Going deeper

- Follow up a suspected leak with `--heap-snapshots`. It writes before and after `.heapsnapshot` files per target, streamed to disk. Diff them in DevTools (Memory panel, Comparison view). If chrome-devtools-mcp is installed with `--memoryDebugging=true`, use its `compare_heapsnapshots` and `get_heapsnapshot_retaining_paths`.
- When you need a frame-by-frame view of the browser (rendering, paint, GPU), use `--trace`. It writes a trace you can load in the Performance panel. It adds a JS sampler, even with `--no-profile`, so read pictures from it, not numbers.
- When another tool drives the app (Playwright, a k6 script), use `run "<cmd>"` as the action so it is measured as one step.
- `--filter STR` keeps only functions whose resolved source path contains STR, such as `app/dashboard` or `lib/db`, in the app lists. It does not change top self.

## Report

For each action or route, state CPU (server and browser main thread) and long tasks from the `--no-profile` pass, allocated and retained memory, and the top 3 app functions, with the iteration count and whether the build was dev or prod. For a before and after comparison, run both on the same build mode, with the same `--repeat` and throttle, and quote the results directory.
