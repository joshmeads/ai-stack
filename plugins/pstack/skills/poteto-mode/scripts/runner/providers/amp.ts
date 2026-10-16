import { adapter, type LaunchFacts, type ParseResult } from "../registry/contract.ts";
import type { NormalizedUsage } from "../types.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, normalizedUsage, nullableString, object, type JsonObject } from "./shared.ts";

// Amp has no OS sandbox and auto-approves `ask` rules in execute mode, so the run-owned settings file is the whole
// read-only boundary: Read is the only enabled tool, and every other tool is rejected. It also turns off MCP servers,
// both skill sources, updates and notifications. Measured with Amp CLI 0.0.1792094445-g3475f5.
const LOCKDOWN = {
  "amp.mcpServers": {},
  "amp.skills.disableClaudeCodeSkills": true,
  "amp.skills.disableGlobalAgentsSkills": true,
  "amp.tools.enable": ["Read"],
  "amp.permissions": [
    { tool: "Read", action: "allow" },
    { tool: "create_file", action: "reject" },
    { tool: "edit_file", action: "reject" },
    { tool: "apply_patch", action: "reject" },
    { tool: "shell_command", action: "reject" },
    { tool: "code_exec", action: "reject" },
    { tool: "*", action: "reject" },
  ],
  "amp.updates.mode": "disabled",
  "amp.notifications.enabled": false,
};

// SIGINT and SIGTERM both exit 0 with this result error.
const CANCELLED = "User cancelled (SIGINT/SIGTERM)";

function summed(entries: readonly NormalizedUsage[]): NormalizedUsage | null {
  if (entries.length === 0) return null;
  const total: Record<string, number> = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined) total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

// Claude Code-style stream JSON. The result event decides, because failures and cancellations exit 0.
function parse(stdout: string): ParseResult {
  let result: JsonObject | null = null;
  const usage: NormalizedUsage[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { kind: "malformed", message: "amp emitted a non-JSON event" };
    }
    const event = object(raw);
    if (event?.type === "assistant") {
      const entry = normalizedUsage(object(event.message)?.usage);
      if (entry !== null) usage.push(entry);
    }
    if (event?.type === "result") result = event;
  }
  if (result === null) return { kind: "malformed", message: "amp stream did not contain a result event" };
  if (typeof result.is_error !== "boolean") {
    return { kind: "malformed", message: "amp result did not contain a valid terminal status" };
  }
  const metadata = { reportedModel: null, sessionId: nullableString(result.session_id), usage: summed(usage), costUsd: null };
  if (result.is_error) {
    const message = nullableString(result.error) ?? `amp reported ${String(result.subtype)}`;
    return { kind: "provider-failure", status: message === CANCELLED ? "cancelled" : "child-failed", message, metadata };
  }
  if (result.subtype !== "success") return { kind: "malformed", message: `amp result subtype was ${String(result.subtype)}` };
  const text = nullableString(result.result);
  if (text === null) return { kind: "malformed", message: "amp result did not contain final text" };
  return { kind: "complete", text, metadata };
}

function settingsPath(facts: LaunchFacts): string {
  const config = facts.providerSidecar?.config ?? null;
  if (config === null) throw new Error("amp argv needs the lane's provider settings path");
  return config;
}

export const amp = adapter({
  id: "amp",
  executable: "amp",
  effortIn: "model-id",
  preflight: {
    argv: () => ["usage"],
    retryAfterUnauthenticatedMs: null,
    // The first line holds the account email and the next one the credit balance, so the evidence is fixed.
    classify(run) {
      if (run.exitCode === 0 && run.stdout.startsWith("Signed in as ")) return { kind: "passed", evidence: "authenticated" };
      if (run.exitCode === 1 && `${run.stdout}\n${run.stderr}`.includes("Invalid or missing API key")) {
        return { kind: "unauthenticated" };
      }
      return { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: "settings.json", content: () => `${JSON.stringify(LOCKDOWN, null, 2)}\n` } },
    // No sandbox: a shell write escaped the cwd whenever the shell was allowed, so Amp has no bounded writer.
    supports: ["read-only"],
    // A cwd .amp/settings.json overrides the run-owned settings, and .amp/plugins/*.ts runs at startup.
    projectConfig: [".amp/"],
    needsSharedGitDir: () => false,
    argv: (lane, facts) => [
      "-x",
      "--stream-json",
      "-m",
      lane.cliModel,
      "--settings-file",
      settingsPath(facts),
      // Every captured thread was private; a repository's visibility mapping was not tested.
      "--visibility",
      "private",
      "--no-ide",
      "--no-notifications",
      "-l",
      "pstack-runner",
    ],
  },
  parse: (run) => parse(run.stdout),
  // The stream never names the model. The pinned official mode is the evidence.
  proof: { report: "absent", matches: () => false },
  // No AMP_ prefix: AMP_SETTINGS_FILE, AMP_EXECUTOR (`orb` runs the turn remotely), AMP_INITIAL_AGENT_MODE_KEY and
  // AMP_URL would change the settings, where the turn runs, the mode or the service.
  environment: () => ({
    kind: "allowlist",
    names: [...BASE_ALLOWLIST, "AMP_API_KEY"],
    prefixes: BASE_PREFIXES,
    set: { AMP_IGNORE_GUIDANCE_FILES: "*" },
  }),
  docs: {
    name: "Amp CLI",
    hostPrerequisites: [],
    statePaths: [
      "`~/.local/share/amp/` (the login in `secrets.json`, accounts, session and recent threads) and `~/.cache/amp/` (logs, downloaded plugins and skills)",
    ],
    notes: [
      "Effort is part of the model ID. The model is an official Amp agent mode, such as `deepseek-v4.1-flash`, from Amp's own `official-modes` plugin, which Amp serves to every user. Where a mode has effort variants, the variant is part of its name (for example `gpt-6-astra-low` to `gpt-6-astra-max`). An unregistered Amp model must be a mode name with the `default` effort. An unknown mode exits 1 with a generic error and ends `child-failed`/70.",
      "Read-only only. Amp has no OS sandbox and auto-approves its `ask` rules in execute mode, and a shell write escaped the cwd whenever the shell was allowed, so no Amp mode is a bounded writer. The runner refuses an `isolated-write` lane before launch.",
      "Each lane gets a run-owned `--settings-file` in its private `<receipt>.provider/` directory (0700). It enables only the `Read` tool and rejects every other tool, which turns off the shell, edits, subagents, web tools, code execution, thread tools and `manage_amp`. It also turns off MCP servers, Claude Code and `~/.agents` skills, updates and notifications. The lane sets `AMP_IGNORE_GUIDANCE_FILES=*`, so `AGENTS.md` in the cwd and its parents does not load. The `official-modes` workspace plugin still loads, because it supplies the modes. `Read` can read any path on the host.",
      "The runner refuses an Amp lane whose cwd, or any parent up to the git root and below the home directory, holds a `.amp/` directory: a `.amp/settings.json` there overrides the run-owned settings, and `.amp/plugins/*.ts` runs its code at startup with no trust check.",
      "The environment is an allowlist that adds only `AMP_API_KEY`. No other `AMP_` name passes: `AMP_SETTINGS_FILE`, `AMP_EXECUTOR`, `AMP_INITIAL_AGENT_MODE_KEY` and `AMP_URL` would change the settings, where the turn runs, the mode or the service.",
      "The preflight is `amp usage`, run without a terminal. It passes when it exits 0 and starts with `Signed in as `, and records the fixed evidence `authenticated`, because the output holds the account email and credit balance. Exit 1 with `Invalid or missing API key` is `unauthenticated`/77, and any other output is `child-failed`/70. A logged-out Amp command other than `amp usage` can open a browser login on its own, which is why the runner never starts a turn without a passing preflight.",
      "The reply, session and token usage come from the stream JSON on stdout: the reply is the `result` event's text, the session is its `session_id` (`T-<uuid>`, also the ampcode.com thread ID), and the usage sums each assistant message's `usage`. The stream has no cost and never names the model, so the proof is the pinned mode in the argv (`pinned-argv`).",
      "Failures and cancellations can exit 0, so the `result` event decides. `is_error: true` with `User cancelled (SIGINT/SIGTERM)` is `cancelled`/130, and any other `is_error` result is `child-failed`/70 with its error text, for example a Claude mode on a subscription-only account. A rejected tool comes back to the model as an ordinary tool result, and the turn can still complete.",
      "Each run is an ampcode.com thread holding the prompt, tool inputs and outputs, the hostname and the working directory. The lane passes `--visibility private` and the label `pstack-runner`; every captured thread was private and archived. Turns spend Amp credits, or a linked ChatGPT subscription for GPT modes.",
    ],
  },
});
