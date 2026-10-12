import { adapter, type ParseResult } from "../registry/contract.ts";
import type { NormalizedUsage } from "../types.ts";
import {
  effortArgs,
  exactOrSuffixed,
  failedPreflight,
  normalizedUsage,
  nullableString,
  object,
} from "./shared.ts";

function parse(stdout: string): ParseResult {
  let text: string | null = null;
  let usage: NormalizedUsage | null = null;
  let sessionId: string | null = null;

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { kind: "malformed", message: "codex emitted a non-JSON event" };
    }
    const event = object(raw);
    if (event === null) continue;
    if (event.type === "thread.started") {
      sessionId = nullableString(event.thread_id) ?? sessionId;
    }
    if (event.type === "item.completed") {
      const item = object(event.item);
      if (item?.type === "agent_message") {
        text = nullableString(item.text) ?? text;
      }
    }
    if (event.type === "turn.completed") {
      usage = normalizedUsage(event.usage) ?? usage;
    }
    if (event.type === "turn.failed") {
      const error = object(event.error);
      return { kind: "malformed", message: nullableString(error?.message) ?? "codex reported a failed turn" };
    }
  }

  if (text === null) {
    return { kind: "malformed", message: "codex result did not contain a final agent message" };
  }
  return {
    kind: "complete",
    text,
    metadata: { reportedModel: null, sessionId, usage, costUsd: null },
  };
}

export const codex = adapter({
  id: "codex",
  executable: "codex",
  preflight: {
    argv: () => ["login", "status"],
    retryAfterUnauthenticatedMs: null,
    classify: (run) => run.exitCode === 0 && /logged in/i.test(`${run.stdout}\n${run.stderr}`)
      ? { kind: "passed", evidence: "authenticated" }
      : failedPreflight(run, "unauthenticated"),
  },
  launch: {
    prompt: "stdin",
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "exec",
      "--model",
      lane.model,
      ...effortArgs(lane, ["--config", `model_reasoning_effort=${JSON.stringify(lane.effort)}`]),
      "--sandbox",
      lane.access.mode === "read-only" ? "read-only" : "workspace-write",
      "--cd",
      lane.cwd,
      "--skip-git-repo-check",
      "--ephemeral",
      "--disable",
      "plugins",
      "--disable",
      "multi_agent",
      "--disable",
      "hooks",
      "--disable",
      "memories",
      "--json",
      "-",
    ],
  },
  parse: (run) => parse(run.stdout),
  // Codex never reports the served model, so the pinned argv is the evidence.
  proof: { report: "absent", matches: exactOrSuffixed },
  environment: () => ({ kind: "inherit", dropPrefixes: [] }),
});
