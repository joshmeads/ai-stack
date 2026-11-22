// Running Claude Code for a part change: where the command is, one call (no tools, a JSON answer back), and what the
// call used.

import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { weigh } from "./savings.ts";
import { type Answer, parseAnswer } from "./answer.ts";
import { type Job, procs, type RunRequest, type Usage } from "./jobs.ts";
import { partSystem } from "./prompts.ts";
import { exec, withFacts } from "./site.ts";

// No clock decides when a change is too slow: the panel shows progress and advises, and the person can stop it.
// These are only a safety net for a run that hangs completely.
export const PART_TIMEOUT_MS = 60 * 60 * 1000;
export const PROJECT_TIMEOUT_MS = 60 * 60 * 1000;

// Where Claude Code usually lives; CLAUDE_BIN overrides, and a bare "claude" falls back to the PATH
export const CANDIDATES = [
  process.env.CLAUDE_BIN,
  join(homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
].filter((p): p is string => !!p);
export const findClaude = () => CANDIDATES.find((p) => existsSync(p)) ?? "claude";

export const PROJECT_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(pnpm add:*)",
  "Bash(pnpm remove:*)",
  "Bash(pnpm install:*)",
  "Bash(pnpm exec tsc:*)",
  "Bash(ls:*)",
  "Bash(node --check:*)",
];

export type CliResult = {
  type?: string;
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};

export const usageOf = (r: CliResult): Usage => ({
  input: (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0),
  output: r.usage?.output_tokens ?? 0,
  costUsd: r.total_cost_usd ?? 0,
  seconds: Math.round((r.duration_ms ?? 0) / 100) / 10,
  turns: r.num_turns,
  weighted: weigh({ input: r.usage?.input_tokens, cacheWrite: r.usage?.cache_creation_input_tokens, cacheRead: r.usage?.cache_read_input_tokens, output: r.usage?.output_tokens }),
});

export type StreamEvent = CliResult & {
  type?: string;
  event?: { type?: string; content_block?: { type?: string }; delta?: { type?: string; text?: string; thinking?: string } };
};

// One part call, streamed so the panel can show it thinking and then writing (and how much)
export async function askPart(prompt: string, r: RunRequest, j: Job, repairing = false): Promise<{ answer: Answer; usage: Usage }> {
  const args = [
    "-p", "--safe-mode", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--tools", "", "--system-prompt", withFacts(partSystem(), "Project facts:"), "--model", r.model, "--effort", r.effort,
  ];
  const cwd = join(tmpdir(), "design-inspector");
  mkdirSync(cwd, { recursive: true });
  let final: CliResult | null = null;
  if (j.progress.phase === "preparing") j.progress.phase = "thinking";
  const out = await exec(findClaude(), args, {
    cwd,
    input: prompt,
    timeout: PART_TIMEOUT_MS,
    onSpawn: (c) => procs.set(j.id, c),
    onLine: (line) => {
      let ev: StreamEvent;
      try {
        ev = JSON.parse(line) as StreamEvent;
      } catch {
        return;
      }
      if (ev.type === "result") final = ev;
      if (ev.type !== "stream_event" || !ev.event) return;
      const e = ev.event;
      if (e.type === "content_block_start" && j.progress.phase !== "fixing") j.progress.phase = e.content_block?.type === "thinking" ? "thinking" : "writing";
      if (e.type === "content_block_delta") {
        if (e.delta?.type === "text_delta") {
          j.progress.written += e.delta.text?.length ?? 0;
          j.progress.writingSince ??= Date.now();
        }
        j.progress.lastAt = Date.now();
      }
    },
  });
  procs.delete(j.id);
  if (j.stopped) throw new Error("Stopped. Nothing was changed.");
  const result = final as CliResult | null;
  if (!result) {
    if (out.timedOut) throw new Error(`Claude was still working after ${PART_TIMEOUT_MS / 60000} minutes with no answer, so it was stopped. Nothing was changed.`);
    throw new Error((out.err.trim() || `Claude Code stopped without an answer (exit code ${out.code ?? "none"}). Nothing was changed.`).slice(0, 400));
  }
  if (result.is_error || !result.result) throw new Error(result.result ?? "Claude returned an error");
  const usage = usageOf(result);
  try {
    return { answer: parseAnswer(result.result), usage };
  } catch (err) {
    // An answer that isn't valid JSON (a stray quote in a CSS value): ask once more for just the JSON
    if (repairing) throw err;
    const why = err instanceof Error ? err.message : String(err);
    j.log.push(`Claude's answer wasn't valid JSON (${why}): asking again for the JSON only`);
    const again = await askPart(`${prompt}\n\nYour last reply to this was not valid JSON (${why}). Reply again with only the JSON object, every string properly escaped.`, r, j, true);
    return { answer: again.answer, usage: addUsage(usage, again.usage) };
  }
}

export const addUsage = (a: Usage | undefined, b: Usage): Usage => ({
  input: (a?.input ?? 0) + b.input,
  output: (a?.output ?? 0) + b.output,
  costUsd: (a?.costUsd ?? 0) + b.costUsd,
  seconds: Math.round(((a?.seconds ?? 0) + b.seconds) * 10) / 10,
  turns: (a?.turns ?? 0) + 1,
  weighted: (a?.weighted ?? 0) + (b.weighted ?? 0),
});
