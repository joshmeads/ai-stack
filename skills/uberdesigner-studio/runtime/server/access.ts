// Who may call the API: guard.ts has the rule, this holds the site's token and applies the rule to a request.

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { refusal } from "./guard.ts";
import { reply } from "./http.ts";
import { ROOT, STATE } from "./site.ts";

// --- who may call the API (guard.ts): only the inspector's own pages on this computer, and for changes only with the
// site's token. The token is made once per site and kept in .inspector/token, so an editor left open keeps working
// when the dev server restarts; the panel gets it with the page (panelTags), local scripts read the file.
export const tokenFile = () => join(STATE, "token");
export let tokenFor = ""; // the site folder the cached token belongs to
export let cachedToken = "";
export function apiToken(): string {
  if (cachedToken && tokenFor === ROOT) return cachedToken;
  let token = "";
  try {
    token = readFileSync(tokenFile(), "utf8").trim();
  } catch {
    /* none yet */
  }
  if (!/^[0-9a-f]{32,}$/.test(token)) {
    token = randomBytes(24).toString("hex");
    mkdirSync(STATE, { recursive: true });
    writeFileSync(tokenFile(), token + "\n", { mode: 0o600 });
  }
  tokenFor = ROOT;
  return (cachedToken = token);
}
export const extraHosts = () => (process.env.DESIGN_INSPECTOR_HOSTS ?? "").split(",");

// Answers 403 and returns false when a request may not go on (serve.ts uses it for its own live-update stream too)
export function allowRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const why = refusal({ method: req.method ?? "GET", path: req.url ?? "", headers: req.headers }, apiToken(), extraHosts());
  if (!why) return true;
  reply(res, 403, { ok: false, error: `uberdesigner studio refused this request: ${why}.` });
  return false;
}
