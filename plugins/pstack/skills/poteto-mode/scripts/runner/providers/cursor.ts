import { adapter, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, boundedOutput, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// Measured with Cursor CLI 2026.10.14-0f9edde. `--mode ask --sandbox enabled` still let MCP, plugin and web tools
// run until this run-owned config denied them: `Mcp(*:*)` blocks every MCP and plugin call, and with no allow rule
// nothing approves a web tool. A project `.cursor/cli.json` replaces this deny list, so the runner refuses `.cursor/`.
const LOCKDOWN = {
  version: 1,
  permissions: { allow: [], deny: ["Write(**)", "Shell(*)", "Mcp(*:*)"] },
  approvalMode: "allowlist",
  sandbox: { mode: "enabled" },
  autoAcceptWebSearch: false,
  webFetchDomainAllowlist: [],
};

function metadata(result: JsonObject): ProviderMetadata {
  const raw = object(result.usage);
  const usage = {
    inputTokens: finiteNumber(raw?.inputTokens),
    cachedInputTokens: finiteNumber(raw?.cacheReadTokens),
    cacheCreationInputTokens: finiteNumber(raw?.cacheWriteTokens),
    outputTokens: finiteNumber(raw?.outputTokens),
  };
  return {
    reportedModel: null,
    sessionId: nullableString(result.session_id),
    usage: Object.values(usage).some((value) => value !== undefined) ? usage : null,
    costUsd: null,
  };
}

function assistantText(event: JsonObject): string {
  const content = object(event.message)?.content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => object(part)).filter((part) => part?.type === "text")
    .map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

// Stream JSON on stdout. The result event decides. Its `result` joins every assistant text segment, such as
// "I'll read the file." before a tool call, so the reply is the last assistant event's text.
function parse(stdout: string): ParseResult {
  let result: JsonObject | null = null;
  let reply: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { kind: "malformed", message: "cursor emitted a non-JSON event" };
    }
    const event = object(raw);
    if (event?.type === "assistant") reply = assistantText(event);
    if (event?.type === "result") result = event;
  }
  // SIGINT (130) and SIGTERM (143) leave no result event.
  if (result === null) return { kind: "malformed", message: "cursor stream did not contain a result event" };
  if (typeof result.is_error !== "boolean") {
    return { kind: "malformed", message: "cursor result did not contain a valid terminal status" };
  }
  const found = metadata(result);
  if (result.is_error) {
    const message = nullableString(result.result) ?? `cursor reported ${String(result.subtype)}`;
    return { kind: "provider-failure", status: "child-failed", message, metadata: found };
  }
  if (result.subtype !== "success") return { kind: "malformed", message: `cursor result subtype was ${String(result.subtype)}` };
  if (reply === null || reply.length === 0) return { kind: "malformed", message: "cursor stream did not contain an assistant reply" };
  return { kind: "complete", text: reply, metadata: found };
}

export const cursor = adapter({
  id: "cursor",
  // Cursor also installs `agent`, which can resolve to another CLI on PATH, such as Grok's.
  executable: "cursor-agent",
  effortIn: "model-id",
  preflight: {
    // `status` reports a stored login as authenticated while every model call fails, and it ignores
    // CURSOR_API_KEY, so the preflight asks for the model list a turn would use.
    argv: () => ["models"],
    retryAfterUnauthenticatedMs: null,
    classify(run, lane) {
      if (run.exitCode === 0 && run.stdout.startsWith("Available models")) {
        const listed = run.stdout.split("\n").some((line) => line.startsWith(`${lane.cliModel} - `));
        return listed ? { kind: "passed", evidence: `model ${lane.cliModel} listed` } : { kind: "unavailable-model" };
      }
      // Empty output is never unauthenticated (#94).
      return run.exitCode === 1 && /^Error: Authentication required/m.test(boundedOutput(run))
        ? { kind: "unauthenticated" }
        : { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: "cli-config.json", content: () => `${JSON.stringify(LOCKDOWN, null, 2)}\n` } },
    // In agent mode the edit tool wrote outside the cwd under every flag combination, so no mode is a bounded writer.
    supports: ["read-only"],
    // A project `.cursor/cli.json` replaces the run-owned deny list and `.cursor/hooks.json` hooks run. Hooks in
    // `.claude/settings.json` and `.claude/settings.local.json` also run, and no flag stops any of them.
    projectConfig: [".cursor/", ".claude/settings.json", ".claude/settings.local.json"],
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      lane.cliModel,
      // The only combination that refused every edit and shell request, including `ls`.
      "--mode",
      "ask",
      "--sandbox",
      "enabled",
      // A new directory otherwise exits 1 with `Workspace Trust Required`.
      "--trust",
    ],
  },
  parse: (run) => parse(run.stdout),
  // The init event's `model` is a display label such as `Claude Opus 5.5 300K High`, not the ID.
  proof: { report: "absent", matches: () => false },
  // CURSOR_CONFIG_DIR keeps `-p` from rewriting `~/.cursor/cli-config.json`. No CURSOR_ prefix:
  // CURSOR_API_ENDPOINT, CURSOR_API_BASE_URL, CURSOR_SANDBOX_POLICY_DIR and CURSOR_FORCED_SHELL_EGRESS
  // change the service, the sandbox or the egress.
  environment: (_access, sidecarDir) => ({
    kind: "allowlist",
    names: [...BASE_ALLOWLIST, "CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"],
    prefixes: BASE_PREFIXES,
    set: { CURSOR_CONFIG_DIR: `${sidecarDir}` },
  }),
  docs: {
    name: "Cursor CLI (`cursor-agent`)",
    hostPrerequisites: [],
    statePaths: [
      "`~/.cursor/`, where the CLI reads `mcp.json`, `hooks.json`, plugins and skills and writes `chats/`, `projects/<slug>/`, `statsig-cache.json` and `agent-cli-state.json`; the stored login is in the macOS keychain",
      "`<receipt>.provider/`, the run-owned `CURSOR_CONFIG_DIR`, where the CLI writes `chats/` and `statsig-cache.json` and rewrites `cli-config.json` at 0644 with an identity block, keeping the run-owned permissions",
      "`~/Library/Caches/cursor-compile-cache/`, `$TMPDIR/cursor-agent-logs-<uid>/` and `~/.npm/_npx/`, which it writes",
    ],
    notes: [
      "The executable is `cursor-agent`. Cursor also installs `agent`, and on a host where another CLI's `agent` comes first on PATH (Grok's, for example), `agent status --format json` exits 2 with empty stdout, which looked like an empty Cursor status in #94.",
      "Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort, such as `gemini-3.7-flash-high`. An unregistered Cursor model must be a CLI model ID with the `default` effort. An unknown model exits 1 with `Cannot use this model: <id>`, which is `unavailable-model`/69.",
      "Read-only only. A lane runs `-p --output-format stream-json --mode ask --sandbox enabled --trust` with the prompt on stdin. Only `--mode ask --sandbox enabled` refused every edit and shell request, including `ls`; the CLI's permission check enforces it, and the Read tool still works. In agent mode the edit tool wrote outside the cwd under every flag combination, so no Cursor mode is a bounded writer. The runner refuses an `isolated-write` lane before launch. `--trust` is required in a new directory. The lane never passes `--force`, `--yolo` or `--approve-mcps`.",
      "Each lane sets `CURSOR_CONFIG_DIR` to its private `<receipt>.provider/` directory (0700) and writes `cli-config.json` there (0600) before the preflight. The config denies `Write(**)`, `Shell(*)` and `Mcp(*:*)`, sets `approvalMode: \"allowlist\"` with no allow rules, enables the sandbox, and turns off web-search auto-approval and the web-fetch domain allowlist. MCP and plugin tools (such as the GitHub, Gmail and Calendar plugins) are still listed to the model, but every call is blocked. Web search and web fetch are refused, because nothing approves them. A Task subagent runs with the same limits. Without the run-owned directory, every `-p` run rewrites `~/.cursor/cli-config.json` with its default model and an identity block.",
      "The runner refuses a Cursor lane whose cwd, or any parent up to the git root and below the home directory, holds `.cursor/`, `.claude/settings.json` or `.claude/settings.local.json`. A project `.cursor/cli.json` replaces the run-owned deny list (a measured run then called the GitHub plugin's `get_me`), `.cursor/hooks.json` hooks run, and the hooks in both `.claude/` settings files run. No flag stops any of them.",
      "No flag turns off the operator's own configuration. Hooks in `~/.cursor/hooks.json` and `~/.claude/settings.json` run inside every turn, and host skills (from `~/.cursor`, `~/.claude`, `~/.codex` and `~/.agents`), account plugins and `~/.cursor/mcp.json` still load. The run-owned deny list limits only what their tools can do. A repository's `AGENTS.md`, `CLAUDE.md`, `.cursorrules` and rules load as always-applied rules.",
      "The environment is an allowlist that adds only `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`, the two logins the CLI's own error names, and sets `CURSOR_CONFIG_DIR`. No other `CURSOR_` name passes: `CURSOR_API_ENDPOINT`, `CURSOR_API_BASE_URL`, `CURSOR_SANDBOX_POLICY_DIR`, `CURSOR_FORCED_SHELL_EGRESS` and the rest change the service, the sandbox or the egress. On the measured macOS host, a `cursor-agent login` run while `CURSOR_API_KEY` was set left a stored login that `status` reported as authenticated but that failed every model call once the variable was gone; signing out and in again with `env -u CURSOR_API_KEY cursor-agent login` fixed it.",
      "The preflight runs `cursor-agent models`, not `status`: `status` reports a stored login as authenticated while every model call fails with `Authentication required`, and it ignores `CURSOR_API_KEY`. The preflight passes when `models` exits 0, its stdout starts with `Available models`, and a line starts with `<CLI model ID> - `, and records the fixed evidence `model <id> listed`. Exit 0 without that line is `unavailable-model`/69. Exit 1 with `Error: Authentication required` is `unauthenticated`/77. Any other output, including empty output, is `child-failed`/70.",
      "The `result` event decides. A `success` result with `is_error: false` is complete, and the reply is the last `assistant` event's text, because the `result` field joins every assistant text segment of the turn. `is_error: true` is `child-failed`/70 with its text. A refused tool comes back to the model as a tool result, and the turn can still complete. SIGINT exits 130 and SIGTERM 143 with no `result` event. The session is `session_id`, and usage is `result.usage`, with `cacheReadTokens` as cached input and `cacheWriteTokens` as cache creation. Cursor reports no cost.",
      "Cursor never reports the served model ID. The init event's `model` is a display label such as `Claude Opus 5.5 300K High`, so the proof is the pinned argv (`pinned-argv`).",
      "Each turn leaves a detached `worker-server` and `typescript-language-server` pair in the CLI's process group. They exit after about five idle minutes.",
    ],
  },
});
