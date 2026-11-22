// What the inspector writes, compared with a snapshot of the site taken before the editor opened:
//   idle      open the editor and scroll through the page: no file and no map entry may change
//   value     the first layer with a number control: change it by 20%, Save
//   text      double-click a text written once in the site's files, type, Enter; then Undo (the footer's, or the card's)
//   motion    a "Motion in the CSS" duration: +0.1 s (written straight into its rule)
//   claude    a Claude change with a scripted answer (a new token in the tokens file, described in the map), then Undo
//   restore   History → go back to the first version (the starting point): every file back byte for byte
// After each step: which files differ from the snapshot, whether the map lost layers or tokens, how many tunable
// values lost their place in the code, and which tokens the map describes that the code doesn't define. Claude is
// never called for real (the runner gives the server a stand-in, which answers only the scripted change), so a text
// that goes to Claude simply doesn't land.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { layerSelector } from "./cdp.mjs";

const SKIP = ["node_modules", "dist", ".inspector", "inspector.map.json"];

function differing(snap, site) {
  let out = "";
  try {
    execFileSync("diff", ["-rq", ...SKIP.flatMap((x) => ["-x", x]), snap, site], { encoding: "utf8" });
  } catch (err) {
    out = String(err.stdout ?? "");
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.replaceAll(snap, "").replaceAll(site, "").replace(/^Files (\S+) and \S+ differ$/, "$1"));
}

export default async function writes(t, { site, snap, captureDir }) {
  const mapOf = (dir) => JSON.parse(readFileSync(`${dir}/inspector.map.json`, "utf8"));
  const m0 = mapOf(snap);
  const words = (dir) => {
    try {
      return execFileSync("grep", ["-rlF", "--exclude-dir=node_modules", "--exclude-dir=.inspector", "--exclude-dir=dist", "Zebra regression words", dir], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  const lostValues = async () => {
    let lost = 0;
    for (const p of mapOf(site).parts.filter((x) => x.params?.length)) {
      const d = await t.ev(`fetch('/__inspector/params?part=${encodeURIComponent(p.id)}').then(r => r.json())`).catch(() => null);
      lost += Object.values(d?.values ?? {}).filter((v) => v === null).length;
    }
    return lost;
  };
  // Tokens the map describes that its tokens file doesn't define: verify's "described but isn't in" error
  const tokensMissing = () => {
    const m = mapOf(site);
    if (!m.tokensFile) return [];
    const css = readFileSync(`${site}/${m.tokensFile}`, "utf8");
    return Object.keys(m.tokens ?? {}).filter((n) => !css.includes(`${n}:`));
  };
  const steps = [];
  const step = async (name, extra = {}) => {
    const m = mapOf(site);
    const ids = (x) => x.parts.filter((p) => !p.removed).map((p) => p.id);
    steps.push({
      name,
      files: differing(snap, site),
      layersLost: ids(m0).filter((id) => !ids(m).includes(id)),
      tokensLost: Object.keys(m0.tokens ?? {}).filter((k) => !(k in (m.tokens ?? {}))),
      valuesLost: await lostValues(),
      tokensMissing: tokensMissing(),
      ...extra,
    });
  };
  const clickButton = (re) => t.ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent.trim()) && !b.disabled); if (!b) return false; b.click(); return true; })()`);
  const ids = m0.parts.filter((p) => !p.removed && p.id !== "site").map((p) => p.id);
  const pick = (id) => t.ev(`document.querySelector('button[data-layer="${id}"]')?.click()`);
  await t.sleep(8000);

  for (let y = 0; y <= 6000; y += 600) {
    await t.fev(`w.scrollTo(0, ${y})`);
    await t.sleep(300);
  }
  await t.fev(`w.scrollTo(0, 0)`);
  await t.sleep(2500);
  await step("idle");

  let valued = null;
  for (const id of ids.slice(0, 25)) {
    await pick(id);
    await t.sleep(500);
    valued = await t.ev(`(() => { const i = document.querySelector('input[type=number]'); if (!i) return null; const v = +i.value; const n = v === 0 ? 1 : +(v * 1.2).toFixed(3); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, String(n)); i.dispatchEvent(new Event('input', { bubbles: true })); return '${id}: ' + v + ' → ' + n; })()`);
    if (valued) break;
  }
  await t.sleep(400);
  // A token waits for Save; a setting in the code is written on Enter
  await t.key("Enter", "Enter", 13);
  await t.sleep(600);
  const saved = (await clickButton(/^Save$/)) || "written on Enter";
  await t.sleep(4000);
  await step("value", { valued, saved });

  let edited = null;
  for (const id of ids.slice(0, 40)) {
    const text = await t.fev(`(() => { const e = d.querySelector('${layerSelector(id)}'); const n = e && [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim().length > 3); if (!n) return null; const r = d.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return b.width > 10 && b.top > 0 && b.bottom < w.innerHeight ? n.textContent.trim() : null; })()`);
    if (!text || !/^[\w ,.'’-]+$/.test(text)) continue;
    let count = 0;
    try {
      count = execFileSync("grep", ["-rhoF", "--exclude-dir=node_modules", "--exclude-dir=.inspector", "--exclude-dir=dist", text, site], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
    } catch {
      count = 0;
    }
    if (count !== 1) continue; // text written several times goes to Claude, which the suite doesn't call
    await pick(id);
    await t.sleep(1200);
    const at = await t.fev(`(() => { const e = d.querySelector('${layerSelector(id)}'); const n = [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim().length > 3); const r = d.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); return [b.left + 4, b.top + b.height / 2]; })()`);
    const [x, y] = await t.toEditor(at[0], at[1]);
    await t.dbl(x, y);
    await t.sleep(700);
    const ok = await t.fev(`(() => { const e = d.activeElement; if (!e || !e.isContentEditable) return false; const r = d.createRange(); r.selectNodeContents(e); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
    if (!ok) continue;
    await t.send("Input.insertText", { text: "Zebra regression words" });
    await t.key("Enter", "Enter", 13);
    edited = id;
    break;
  }
  await t.sleep(4000);
  await step("text", { edited, inFiles: words(site) });
  let undone = false;
  if (edited) {
    // Where a direct edit is taken back: the footer's Undo beside "Text saved to the file" (a direct edit makes no
    // card); in versions where it made one, the card's Undo on the changes tab
    undone = await clickButton(/^Undo$/);
    if (!undone) {
      await t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /changes/i.test(b.textContent))?.click()`);
      for (let i = 0; i < 20 && !(undone = await clickButton(/^Undo( this)?$/)); i++) await t.sleep(500);
    }
    await t.sleep(5000);
  }
  await step("text undo", { undone, inFiles: words(site) });

  let motion = null;
  await t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /^Elements$/.test(b.textContent.trim()))?.click()`);
  await t.sleep(500);
  for (const id of ids.slice(0, 40)) {
    await pick(id);
    await t.sleep(500);
    const input = await t.ev(`(() => { const h = [...document.querySelectorAll('h3')].find(h => /Motion in the CSS/.test(h.textContent)); let el = h?.nextElementSibling; while (el && !el.querySelector('input[type=range]')) el = el.nextElementSibling; const r = el?.querySelector('input[type=range]'); if (!r) return null; const b = r.getBoundingClientRect(); return { v: +r.value, x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!input) continue;
    // Move the slider with the keyboard: one step right, then let go (the panel writes on key up)
    await t.click(input.x, input.y);
    await t.key("ArrowRight", "ArrowRight", 39);
    motion = `${id}: ${input.v} → (one step)`;
    break;
  }
  await t.sleep(4000);
  await step("motion", { motion });

  // A Claude change through the real write path (the stand-in returns a scripted answer): a new token in the tokens
  // file, described in the map, as Claude does; then its Undo. Both the files and the map must come back.
  let scripted = null;
  const tf = m0.tokensFile;
  if (tf && captureDir) {
    const text = readFileSync(`${site}/${tf}`, "utf8");
    const line = [...text.matchAll(/^[ \t]*(--[\w-]+)[ \t]*:[^;\n]+;/gm)].map((x) => x[0].trim()).find((x) => text.split(x).length === 2);
    const part = m0.parts.find((p) => !p.removed && p.id !== "site");
    if (line && part) {
      writeFileSync(
        `${captureDir}/answer.json`,
        JSON.stringify({ summary: "Added a suite test token.", edits: [{ file: tf, find: line, replace: `${line}\n  --suite-test-gap: 13px;` }], create: [], needs: null, map: { tokens: { "--suite-test-gap": { kind: "size", role: "A token the sites suite adds and undoes", label: "Suite test gap" } } } }),
      );
      const body = { mode: "part", part: part.label, prompt: "", request: "Add a suite test token.", partId: part.id, model: "claude-opus-5-5", effort: "low" };
      const job = await t.ev(`fetch('/__inspector/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Inspector-Token': window.__INSPECTOR_TOKEN__ ?? '' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.json()).then(d => d.job?.id ?? null)`);
      let state = null;
      let thread = null;
      for (let i = 0; i < 60 && job; i++) {
        await t.sleep(1000);
        const j = await t.ev(`fetch('/__inspector/jobs').then(r => r.json()).then(d => d.jobs.find(x => x.id === ${JSON.stringify(job)}) ?? null)`);
        state = j?.state ?? null;
        thread = j?.thread ?? null;
        if (state === "done" || state === "error") break;
      }
      scripted = state;
      await step("claude change", { scripted: state, described: "--suite-test-gap" in (mapOf(site).tokens ?? {}) });
      if (thread) await t.ev(`fetch('/__inspector/undo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Inspector-Token': window.__INSPECTOR_TOKEN__ ?? '' }, body: ${JSON.stringify(JSON.stringify({ thread }))} }).then(r => r.json())`);
      await t.sleep(3000);
      await step("claude undo", { described: "--suite-test-gap" in (mapOf(site).tokens ?? {}) });
    }
  }

  await t.ev(`[...document.querySelectorAll('button[role=tab]')].find(b => /History/.test(b.textContent))?.click()`);
  await t.sleep(1500);
  // A change still running (a text sent to the stand-in) blocks a restore: wait for it
  for (let i = 0; i < 30 && (await t.ev(`fetch('/__inspector/jobs').then(r => r.json()).then(d => d.jobs.some(j => ['queued','running','applying','thinking','writing'].includes(j.state)))`)); i++) await t.sleep(1000);
  const restored = await t.ev(`(() => { const b = [...document.querySelectorAll('li button')].filter(b => /^(Restore|Go back here)$/.test(b.textContent.trim())).pop(); if (!b) return false; b.click(); return true; })()`);
  await t.sleep(6000);
  await step("restore", { restored });
  return { steps };
}

export function compareWrites(a, b) {
  const lines = [];
  const A = new Map(a.steps.map((s) => [s.name, s]));
  for (const s of b.steps) {
    const o = A.get(s.name);
    if (!o) continue;
    const f = (x) => (x.files.length ? x.files.join(", ") : "none");
    if (f(o) !== f(s)) lines.push(`${s.name}: files changed ${f(o)} → ${f(s)}`);
    if (o.layersLost.join() !== s.layersLost.join()) lines.push(`${s.name}: layers lost ${o.layersLost.join(", ") || "none"} → ${s.layersLost.join(", ") || "none"}`);
    if (o.tokensLost.join() !== s.tokensLost.join()) lines.push(`${s.name}: tokens lost ${o.tokensLost.join(", ") || "none"} → ${s.tokensLost.join(", ") || "none"}`);
    if (o.valuesLost !== s.valuesLost) lines.push(`${s.name}: values lost ${o.valuesLost} → ${s.valuesLost}`);
    if ((o.tokensMissing ?? []).join() !== (s.tokensMissing ?? []).join()) lines.push(`${s.name}: tokens described but not in the code ${(o.tokensMissing ?? []).join(", ") || "none"} → ${(s.tokensMissing ?? []).join(", ") || "none"}`);
    for (const k of ["saved", "undone", "restored", "inFiles", "scripted", "described"]) if (k in s && o[k] !== s[k]) lines.push(`${s.name}: ${k} ${o[k]} → ${s[k]}`);
  }
  const last = b.steps.find((s) => s.name === "restore");
  return { summary: `restore leaves ${last?.files.length ? last.files.join(", ") : "every file as it was"}; idle changes ${b.steps[0]?.files.length ? b.steps[0].files.join(", ") : "nothing"}`, lines };
}
