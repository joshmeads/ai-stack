import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserPort, getJson } from "./cdp.mjs";
import { sleep } from "./util.mjs";

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found. Set CHROME_PATH.");
  return found;
}

export async function launch(opts, url) {
  const p = browserPort(opts);
  const already = await getJson(p, "/json/version").catch(() => null);
  if (already) return void console.log(`Chrome already listening on ${p} (${already.Browser}); cdt's launch flags apply only to a Chrome it starts`);
  const profile = join(tmpdir(), `cdt-profile-${p}`);
  const args = [
    `--remote-debugging-port=${p}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--disable-features=BackForwardCache",
    ...(opts.headless ? ["--headless=new"] : []),
    url ?? "about:blank",
  ];
  spawn(findChrome(), args, { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 100; i++) {
    const v = await getJson(p, "/json/version").catch(() => null);
    if (v) return void console.log(`Chrome ${v.Browser} on port ${p}, profile ${profile}`);
    await sleep(100);
  }
  throw new Error("Chrome did not open its debugging port within 10s (inside a sandbox? Chrome needs to run unsandboxed)");
}
