// Who may call the inspector's API. The dev server listens on this computer, and so does every website open in the
// same browser: a page on another site can send requests to http://localhost:<port>/__inspector/… without being able
// to read the answers. Unchecked, that is enough to start a Claude Code run in the person's project. So every
// /__inspector/ request must:
//
// 1. be addressed to this computer by name (Host is localhost, 127.0.0.1 or [::1]; DESIGN_INSPECTOR_HOSTS adds names
//    for people who open their dev server under another one, comma-separated). This stops a foreign domain that
//    points itself at 127.0.0.1;
// 2. come from the inspector's own pages: when the browser says where a request comes from (Sec-Fetch-Site, Origin),
//    it must be this same address;
// 3. and, to change anything (every POST): be sent as JSON and carry the inspector's token. The token is made once per
//    site (.inspector/token), handed to the panel with the page, and readable by programs on this computer (the
//    backtest, the sites suite), which the person already trusts. A page on another site can't read it, and a request
//    with a custom header isn't sent by a browser across sites without the server's leave, which is never given.
//
// Plain logic with no imports, so it's tested on its own (tests/unit/guard.test.mjs).

export type Asked = { method: string; path: string; headers: Record<string, string | string[] | undefined> };

export const TOKEN_HEADER = "x-inspector-token";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)$/i;
// An upload is the file itself, not JSON
const RAW_BODY = /^\/__inspector\/media\?/;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const hostName = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

// Why a request is refused, in plain words; null when it may go on
export function refusal(asked: Asked, token: string, extraHosts: string[] = []): string | null {
  const host = one(asked.headers.host);
  const name = hostName(host);
  if (!name || !(LOCAL.test(name) || extraHosts.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(name)))
    return `uberdesigner studio answers only on this computer (localhost), not on "${name || "an unnamed host"}". To use another name, start the dev server with DESIGN_INSPECTOR_HOSTS=${name || "<name>"}`;
  // Opening a page (a link to the editor in a README, a bookmark) is fine from anywhere: it only shows the page
  const opening = asked.method === "GET" && one(asked.headers["sec-fetch-mode"]) === "navigate";
  const site = one(asked.headers["sec-fetch-site"]);
  if (!opening && site && site !== "same-origin" && site !== "none") return "the request came from another website";
  const origin = one(asked.headers.origin);
  if (origin && !opening) {
    let from = "";
    try {
      from = new URL(origin).host.toLowerCase();
    } catch {
      /* "null" (a sandboxed page) or not an address: refused below */
    }
    if (from !== host.toLowerCase()) return "the request came from another website";
  }
  if (asked.method === "GET" || asked.method === "HEAD") return null;
  if (asked.method !== "POST") return "uberdesigner studio takes only GET and POST";
  if (!RAW_BODY.test(asked.path) && !/^application\/json\b/i.test(one(asked.headers["content-type"]))) return "changes must be sent as JSON";
  const sent = one(asked.headers[TOKEN_HEADER]);
  if (!token || sent.length !== token.length || sent !== token) return "the request didn't carry this site's studio token (reload the editor if the dev server was reinstalled)";
  return null;
}
