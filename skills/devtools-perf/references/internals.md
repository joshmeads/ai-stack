# cdt internals

Read this before changing `scripts/`. Each rule exists because the obvious alternative failed on a real run. The code has no comments, so these rules live here.

- **The hook patches CommonJS compilation.** `next-sourcemaps-hook.cjs` wraps `Module.prototype._compile`, not `module.registerHooks`. On Node 22, a load hook breaks `require()` inside a CommonJS module reached through `import()`, and Next loads its commands that way.
- **Measurement order is the contract.** Take the last sample, then send `Tracing.end` and the profiler stops together. Then force GC and take the retained sample. Only then drain the trace, resolve source maps and write artifacts. Anything slower inside that window counts against the step or against a measured server. Resolving maps fetches them from the server being measured, so it stays last.
- **Back/forward cache stays off in `cdt launch`.** A page Chrome keeps for the back button stays in the heap and reads as a leak.
- **A source map must come from where its script came from.** An http script's `sourceMappingURL` can name a local path, and reading it would put local file contents into the report. `sameOrigin` in `lib/sourcemap.mjs` holds this rule.
