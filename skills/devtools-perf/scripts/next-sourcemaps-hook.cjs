// Preloaded by `cdt next` (node --require) into Next and every Node process
// it spawns. Wraps Next's loadConfig in memory so the build and server use
// source maps and the separate distDir .next/cdt-profile; next.config is
// never edited. Fails closed: anything that would let Next write to the
// project's own .next throws instead.
const { registerHooks } = require("node:module");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { fileURLToPath } = require("node:url");

const CONFIG_JS = process.env.CDT_NEXT_CONFIG_JS;
const DIST_DIR = process.env.CDT_NEXT_DIST_DIR;
if (!CONFIG_JS || !DIST_DIR) throw new Error("cdt: next-sourcemaps-hook.cjs only runs under `cdt next`");
if (typeof registerHooks !== "function") throw new Error(`cdt: Node ${process.version} lacks module.registerHooks; cdt next needs Node 22.15+ or 23.5+`);

// Called by the patched loadConfig with each resolved (non-raw) config.
// Checks the overrides took and, once per run, records the tsconfig the
// build may rewrite (as it is before Next touches it) for cdt to restore.
globalThis.__cdtNextConfig = (config, dir) => {
  if (config.output === "export") {
    throw new Error("cdt next: output: 'export' writes build artifacts to .next whatever distDir says, so cdt cannot keep your build untouched. Profile without output: 'export'.");
  }
  config.productionBrowserSourceMaps = true;
  config.experimental = { ...config.experimental, serverSourceMaps: true };
  config.distDir = DIST_DIR;
  if (config.distDir !== DIST_DIR || config.productionBrowserSourceMaps !== true || config.experimental.serverSourceMaps !== true) {
    throw new Error("cdt next: Next's config object refused the overrides; stopping before it builds into your .next");
  }
  const state = process.env.CDT_NEXT_STATE;
  if (!state) return;
  const tsconfigPath = resolve(dir, config.typescript?.tsconfigPath ?? "tsconfig.json");
  let tsconfig = null;
  try { tsconfig = readFileSync(tsconfigPath).toString("base64"); } catch {}
  try {
    writeFileSync(state, JSON.stringify({ pid: process.pid, distDir: config.distDir, tsconfigPath, tsconfig }), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
};

// Appended to Next's server/config.js. rawConfig calls return the user's
// module itself (Turbopack's config validation); those pass through.
// The export check catches a Next that copies loadConfig into exports
// instead of reading the binding live, which would bypass the wrapper.
const PATCH = `
;{
  const __cdtLoadConfig = loadConfig;
  loadConfig = async function (phase, dir, opts) {
    const config = await __cdtLoadConfig.apply(this, arguments);
    if (opts && opts.rawConfig) return config;
    globalThis.__cdtNextConfig(config, dir);
    return config;
  };
  if (exports.default !== loadConfig) throw new Error("cdt next: this Next exports loadConfig by value, so the source-map wrapper cannot take effect");
}
`;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith("file:") || fileURLToPath(url) !== CONFIG_JS) return result;
    const source = String(result.source);
    if (!/\nasync function loadConfig\(/.test(source)) {
      throw new Error("cdt next: this Next version's config loader is not recognised; stopping before it builds into your .next");
    }
    return { ...result, source: source + PATCH };
  },
});
