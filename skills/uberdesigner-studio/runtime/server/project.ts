// A whole-site change: Claude Code works as an agent in the project (reads, edits, adds packages, typechecks),
// streaming its steps.

import { type CliResult, findClaude, PROJECT_TIMEOUT_MS, PROJECT_TOOLS, usageOf } from "./claude.ts";
import { learn, predict } from "./estimates.ts";
import { markPoint, recordOutside } from "./history.ts";
import { type Job, procs, type RunRequest } from "./jobs.ts";
import { designSnapshot, syncMap, touchMap } from "./map-store.ts";
import { PROJECT_SYSTEM } from "./prompts.ts";
import { editableFiles, exec, readSite, rel, withFacts } from "./site.ts";

export function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
      return `Reading ${rel(input.file_path)}`;
    case "Edit":
      return `Editing ${rel(input.file_path)}`;
    case "Write":
      return `Writing ${rel(input.file_path)}`;
    case "Bash":
      return `Running ${String(input.command ?? "")}`;
    case "Glob":
    case "Grep":
      return `Searching ${String(input.pattern ?? "")}`;
    default:
      return name;
  }
}

export async function runProject(j: Job, r: RunRequest) {
  await recordOutside();
  markPoint("Before a whole-site change"); // the one change that can touch everything
  const mapBefore = readSite("inspector.map.json");
  const designBefore = designSnapshot();
  j.eta = predict(r.model, "project", 0);
  const context = r.part && r.part !== "Whole site" ? `The owner picked this part on the page: ${r.part}.\nWhat the build prompt says about it:\n${r.prompt}\n\n` : "";
  const prompt = `${context}Request:\n${r.request.trim()}`;
  const args = [
    "-p",
    "--safe-mode",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    r.model,
    "--effort",
    r.effort,
    "--permission-mode",
    "acceptEdits",
    "--append-system-prompt",
    withFacts(PROJECT_SYSTEM, "Where things are in this project:"),
    // Only the tools a site change needs: every tool definition is resent at every step, so fewer is cheaper
    "--tools",
    "Read,Edit,Write,Glob,Grep,Bash",
    "--exclude-dynamic-system-prompt-sections",
    ...(r.budget ? ["--max-budget-usd", String(r.budget)] : []),
    ...(r.session ? ["--resume", r.session] : []),
    "--allowedTools",
    ...PROJECT_TOOLS,
  ];
  let final: CliResult | null = null;
  const out = await exec(findClaude(), args, {
    input: prompt,
    timeout: PROJECT_TIMEOUT_MS,
    onSpawn: (c) => procs.set(j.id, c),
    onLine: (line) => {
      j.progress.lastAt = Date.now();
      j.progress.phase = "working";
      let ev: { type?: string; session_id?: string; message?: { content?: { type: string; name?: string; text?: string; input?: Record<string, unknown> }[] } } & CliResult;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.session_id) j.session = ev.session_id;
      if (ev.type === "assistant") {
        for (const c of ev.message?.content ?? []) {
          if (c.type === "tool_use" && c.name) j.log.push(describeTool(c.name, c.input ?? {}));
          if (c.type === "text" && c.text?.trim()) j.log.push(c.text.trim().slice(0, 300));
        }
      }
      if (ev.type === "result") final = ev;
    },
  });
  const res = final as CliResult | null;
  procs.delete(j.id);
  if (j.stopped) throw new Error("Stopped. What it changed before you stopped it is kept as a version you can undo.");
  if (!res) {
    if (out.timedOut) throw new Error(`Claude Code was still working after ${PROJECT_TIMEOUT_MS / 60000} minutes, so it was stopped. What it changed so far is kept as a version you can undo.`);
    throw new Error((out.err.trim() || `Claude Code stopped without a result (exit code ${out.code ?? "none"}).`).slice(0, 400));
  }
  j.usage = usageOf(res);
  j.summary = res.result?.trim() ?? "";
  const kept = syncMap(designBefore, editableFiles(), { request: j.request });
  if (kept.length) j.log.push(`Layers kept in step: ${kept.join("; ")}`);
  if (readSite("inspector.map.json") !== mapBefore) {
    j.mapChanged = true;
    touchMap();
  }
  learn(r.model, "project", 0, j);
  if (res.is_error) throw new Error(j.summary || "Claude Code stopped with an error");
}
