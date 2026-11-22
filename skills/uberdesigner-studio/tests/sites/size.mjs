// How much a part change sends to Claude: the same requests (a text layer, a section, a layer with settings, and up
// to five more spread over the map), recorded by the stand-in CLI. Characters of system prompt and request, per request.
import { readdirSync, readFileSync } from "node:fs";

export default async function size(t, { map, captureDir }) {
  const parts = map.parts.filter((p) => !p.removed && p.id !== "site");
  const first = [parts.find((p) => p.kind === "text"), parts.find((p) => p.kind === "section"), parts.find((p) => p.params?.length) ?? parts[5]].filter(Boolean);
  // Three parts say little about a site of forty: five more, evenly spread over the list
  const spread = [1, 2, 3, 4, 5].map((k) => parts[Math.floor((parts.length * k) / 6)]).filter(Boolean);
  const pick = [...new Set([...first, ...spread])];
  const requests = [];
  // History's first version is made when the editor first asks for it, and requests wait behind it: on a site with
  // gigabytes of media that takes most of a minute, and a request sent meanwhile would be read as the next one's
  await t.ev(`fetch('/__inspector/history', { headers: { 'X-Inspector-Token': window.__INSPECTOR_TOKEN__ ?? '' } }).then(r => r.ok)`).catch(() => null);
  for (const p of pick) {
    const before = new Set(readdirSync(captureDir));
    const body = { mode: "part", part: p.label, prompt: (p.prompt ?? []).map((x) => x.text).join("\n"), request: "Make it a little bolder.", partId: p.id, model: "claude-opus-5-5", effort: "medium" };
    // With what the chat bar would send along: the CSS rules the page applies to the part (versions that ask the page)
    await t.ev(`fetch('/__inspector/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Inspector-Token': window.__INSPECTOR_TOKEN__ ?? '' }, body: JSON.stringify({ ...${JSON.stringify(body)}, page: window.__inspectorPageFacts?.(${JSON.stringify(p.id)}) }) }).then(r => r.json())`);
    let file = null;
    for (let i = 0; i < 40 && !file; i++) {
      await t.sleep(250);
      file = readdirSync(captureDir).find((f) => !before.has(f)) ?? null;
    }
    if (!file) {
      requests.push({ part: p.id, system: null, request: null });
      continue;
    }
    await t.sleep(300);
    const c = JSON.parse(readFileSync(`${captureDir}/${file}`, "utf8"));
    requests.push({ part: p.id, system: c.system.length, request: c.input.length });
  }
  return { requests };
}

export function compareSize(a, b) {
  const tot = (x) => x.requests.reduce((n, r) => n + (r.system ?? 0) + (r.request ?? 0), 0);
  const ta = tot(a);
  const tb = tot(b);
  const pct = ta ? (((tb - ta) / ta) * 100).toFixed(1) : "?";
  const lines = b.requests
    .map((r, i) => [r, a.requests[i]])
    .filter(([r, o]) => o && (r.system !== o.system || r.request !== o.request))
    .map(([r, o]) => `${r.part}: ${Math.round(((o.system ?? 0) + (o.request ?? 0)) / 3.6)} → ${Math.round(((r.system ?? 0) + (r.request ?? 0)) / 3.6)} tokens (system ${o.system} → ${r.system} chars, request ${o.request} → ${r.request})`);
  return { summary: `part requests ${Math.round(ta / 3.6)} → ${Math.round(tb / 3.6)} tokens in all (${pct}%)`, lines };
}
