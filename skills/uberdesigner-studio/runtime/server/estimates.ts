// How long a change will take and how many tokens it will use, learned from the changes made before on this site.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Job } from "./jobs.ts";
import { STATE } from "./site.ts";

// How long a run takes, learned from this site's own past runs (same model and kind): the median, scaled a little by
// how much is sent. Until there are a few runs, typical figures stand in.
export type Stat = { model: string; mode: "part" | "project"; input: number; seconds: number; output: number; at: string };
export const statsFile = () => join(STATE, "stats.json");
export const readStats = (): Stat[] => {
  try {
    return JSON.parse(readFileSync(statsFile(), "utf8")) as Stat[];
  } catch {
    return [];
  }
};
export const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
export const TYPICAL: Record<string, number> = { opus: 30, sonnet: 18, haiku: 6, fable: 45, mythos: 45 };

export function predict(model: string, mode: "part" | "project", inputChars: number): { seconds: number; outputChars: number; basis: string } {
  const same = readStats().filter((x) => x.model === model && x.mode === mode).slice(-20);
  if (same.length >= 2) {
    const scale = Math.min(2, Math.max(0.5, (inputChars / Math.max(1, median(same.map((x) => x.input)))) ** 0.35));
    return { seconds: Math.round(median(same.map((x) => x.seconds)) * scale), outputChars: median(same.map((x) => x.output)), basis: `your last ${same.length} runs` };
  }
  const family = Object.keys(TYPICAL).find((k) => model.includes(k)) ?? "sonnet";
  return { seconds: TYPICAL[family] * (mode === "project" ? 8 : 1), outputChars: 2400, basis: "typical runs" };
}

export function learn(model: string, mode: "part" | "project", inputChars: number, j: Job) {
  try {
    mkdirSync(STATE, { recursive: true });
    const stats = [...readStats(), { model, mode, input: inputChars, seconds: Math.round((Date.now() - j.started) / 1000), output: j.progress.written, at: new Date().toISOString() }];
    writeFileSync(statsFile(), JSON.stringify(stats.slice(-200)) + "\n");
  } catch {
    /* estimates are a nicety */
  }
}
