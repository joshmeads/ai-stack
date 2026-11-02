// Preloaded by `cdt next` (node --require). Wraps Next's loadConfig in memory so
// this process builds and serves with source maps into a separate distDir.
// next.config is never edited.
const { registerHooks } = require("node:module");

const PATCH = `
;{
  const __cdtOriginalLoadConfig = loadConfig;
  loadConfig = async function (...args) {
    const config = await __cdtOriginalLoadConfig.apply(this, args);
    config.productionBrowserSourceMaps = true;
    config.experimental = { ...config.experimental, serverSourceMaps: true };
    config.distDir = process.env.CDT_NEXT_DIST_DIR;
    return config;
  };
}
`;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!/[\\/]next[\\/]dist[\\/]server[\\/]config\.js$/.test(url)) return result;
    const source = String(result.source);
    if (!/\nasync function loadConfig\(/.test(source)) {
      process.emitWarning("cdt: this Next version's config loader is not recognised; source maps were not injected");
      return result;
    }
    return { ...result, source: source + PATCH };
  },
});
