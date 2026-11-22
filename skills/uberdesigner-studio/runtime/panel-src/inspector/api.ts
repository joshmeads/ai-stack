// Every call the panel makes to the dev server's /__inspector API. Each one carries the site's inspector token, which
// the dev server put on the page next to the map (server/api.ts panelTags): the server takes changes only from
// requests that have it, so a page on another website open in the same browser can't drive the inspector
// (server/guard.ts). Use this instead of fetch for anything under /__inspector/.

const TOKEN = (globalThis as unknown as { __INSPECTOR_TOKEN__?: string }).__INSPECTOR_TOKEN__ ?? "";

const send = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "X-Inspector-Token": TOKEN } });

// One thing may be asked to happen before any write goes out (the editor uses it: an object that was only picked
// becomes a layer of the map before the first change to it is sent, wherever in the panel that change is made)
let first: ((url: string, body: string) => Promise<void>) | null = null;
export const beforeWrites = (fn: typeof first) => void (first = fn);
export async function api(url: string, init: RequestInit = {}): Promise<Response> {
  if (first && init.method === "POST") await first(url, typeof init.body === "string" ? init.body : "");
  return send(url, init);
}
export const apiDirect = send; // for the one request that must not wait on itself
