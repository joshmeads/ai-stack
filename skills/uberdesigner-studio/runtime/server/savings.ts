// Tokens used and tokens saved, per change and in total. A change through the inspector sends one part's pieces in one
// call, or none at all (typed text, a link, a slider); the same change asked of plain Claude Code, working through the
// project on its own, is a whole agent run. What that run costs is our own estimate, from a backtest on our test sites
// (backtest/run.mjs and its results, on the repo's `benchmark` branch; method in docs/methodology.md): never measured on the person's computer, nothing extra runs there.
// Each change counts the difference; Whole site runs are such a run, so they save nothing.
//
// The totals live in one file in the home folder, so they add up across every site and every chat on this computer:
// ~/.uberdesigner/design-map/totals.json. No prices: tokens only.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// DESIGN_MAP_TOTALS_DIR puts the file elsewhere: the tests set it to a temporary folder, so their scripted changes
// never count into the person's real total.
const DIR = process.env.DESIGN_MAP_TOTALS_DIR || join(homedir(), ".uberdesigner", "design-map");
const FILE = join(DIR, "totals.json");

// Tokens weighted the way usage is priced, relative to fresh input: cache writes 1.25×, cache reads 0.1×, output 5×.
// Plain Claude Code re-reads its instructions from cache on every step, so its raw count is mostly cheap cache reads;
// counting raw tokens would overstate the saving several times over.
export const WEIGHT = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };
export const weigh = (u: { input?: number; cacheWrite?: number; cacheRead?: number; output?: number }) =>
  Math.round((u.input ?? 0) * WEIGHT.input + (u.cacheWrite ?? 0) * WEIGHT.cacheWrite + (u.cacheRead ?? 0) * WEIGHT.cacheRead + (u.output ?? 0) * WEIGHT.output);

// backtest/results-2026-11-18.json (on the `benchmark` branch): 15 everyday changes on three of our sites drawn at random, both ways on the same
// day, Opus 5.5, weighed from the token breakdown the Claude CLI reports (plain Claude Code's checked against its
// logs). Medians, weighted. Averages: 59,136 and 11,739. Raw (cache reads counted in full): 298,767 vs 8,474.
// The method is in docs/methodology.md.
export const BACKTEST = { date: "2026-11-18", cases: 15, claudeCode: 55_552, inspector: 10_775 };

type Count = { used: number; saved: number; changes: number };
type Totals = Count & { version: 1; since: string; sites: Record<string, Count & { name: string }> };
export type TotalsView = { all: Count; site: Count | null; since: string; backtest: typeof BACKTEST };

const empty = (): Totals => ({ version: 1, since: new Date().toISOString(), used: 0, saved: 0, changes: 0, sites: {} });

function read(): Totals {
  try {
    const t = JSON.parse(readFileSync(FILE, "utf8")) as Totals;
    return t.version === 1 ? { ...empty(), ...t } : empty();
  } catch {
    return empty();
  }
}

function write(t: Totals) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`; // whole file at once, so two sites saving together never leave half a file
  writeFileSync(tmp, JSON.stringify(t, null, 2) + "\n");
  renameSync(tmp, FILE);
}

type JobLike = { mode: "part" | "project"; state: string; usage?: { input: number; output: number; weighted?: number }; saved?: number; counted?: boolean; direct?: boolean };

// Count a finished change once: its tokens, and (when it finished) what it saved against the backtest's plain Claude
// Code run. Returns the saving.
export function account(root: string, j: JobLike): number {
  if (j.counted) return j.saved ?? 0;
  j.counted = true;
  const used = j.usage?.weighted ?? (j.usage?.input ?? 0) + (j.usage?.output ?? 0);
  try {
    const t = read();
    // A direct edit (typed words, a slider) saved a part change, not a whole Claude Code run
    const saved = j.mode !== "part" || j.state !== "done" ? 0 : j.direct ? BACKTEST.inspector : Math.max(0, BACKTEST.claudeCode - used);
    const site = (t.sites[root] ??= { name: basename(root), used: 0, saved: 0, changes: 0 });
    for (const c of [t, site]) {
      c.used += used;
      c.saved += saved;
      c.changes += 1;
    }
    write(t);
    j.saved = saved;
    return saved;
  } catch {
    return 0; // the totals are a nicety; a change never fails over them
  }
}

export function totals(root: string): TotalsView {
  const t = read();
  const s = t.sites[root];
  return { all: { used: t.used, saved: t.saved, changes: t.changes }, site: s ? { used: s.used, saved: s.saved, changes: s.changes } : null, since: t.since, backtest: BACKTEST };
}
