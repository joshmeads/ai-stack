import { adapter, type LaunchFacts, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// Devin loads the host's rules (such as CLAUDE.md), MCP servers, web search and subagents by default,
// and no flag turns them off. It rewrites the config file it is given, so run.ts writes this one fresh
// into each lane's private provider directory. Measured with Devin CLI 3000.10.21.
const LOCKDOWN = {
  version: 1,
  subagents_enabled: false,
  read_config_from: {
    agents_standard: false,
    cursor: false,
    windsurf: false,
    claude: false,
    copilot: false,
    opencode: false,
    zed: false,
  },
  permissions: {
    deny: ["mcp__*", "web_search", "webfetch", "run_subagent", "Fetch(https://*)", "Fetch(http://*)"],
  },
};

// SIGINT leaves an export whose last step is this system message; SIGTERM exits 143 with no export.
const INTERRUPTED = "[Response interrupted by user]";
const SIGTERM_EXIT = 143;

const NO_METADATA: ProviderMetadata = { reportedModel: null, sessionId: null, usage: null, costUsd: null };

function metadata(exported: JsonObject, last: JsonObject | null): ProviderMetadata {
  const totals = object(exported.final_metrics);
  const usage = {
    inputTokens: finiteNumber(totals?.total_prompt_tokens),
    cachedInputTokens: finiteNumber(totals?.total_cached_tokens),
    outputTokens: finiteNumber(totals?.total_completion_tokens),
  };
  return {
    // `agent.model_name` is a label such as "SWE-2 Medium"; the generation model is the CLI model ID.
    reportedModel: nullableString(object(last?.extra)?.generation_model),
    sessionId: nullableString(exported.session_id),
    usage: Object.values(usage).some((value) => value !== undefined) ? usage : null,
    costUsd: null,
  };
}

// The ATIF export is the result: stdout can start with a first-use welcome banner, and after a
// cancellation it holds a partial reply.
function parse(run: ModelRun): ParseResult {
  if (run.exitCode === SIGTERM_EXIT) {
    return { kind: "provider-failure", status: "cancelled", message: "devin exited with status 143 after SIGTERM", metadata: NO_METADATA };
  }
  if (run.sidecar === null) return { kind: "malformed", message: "devin wrote no export" };
  let raw: unknown;
  try {
    raw = JSON.parse(run.sidecar);
  } catch {
    return { kind: "malformed", message: "devin export is not valid JSON" };
  }
  const exported = object(raw);
  const steps = Array.isArray(exported?.steps) ? exported.steps : [];
  if (exported === null || steps.length === 0) return { kind: "malformed", message: "devin export has no steps" };
  const last = object(steps.at(-1));
  const found = metadata(exported, last);
  // Devin writes the interruption as a system step; an agent reply with the same text is a reply.
  if (last?.source === "system" && last.message === INTERRUPTED) {
    return { kind: "provider-failure", status: "cancelled", message: "devin reported the response was interrupted", metadata: found };
  }
  if (last?.source !== "agent") return { kind: "malformed", message: "devin export did not end with an agent step" };
  const text = nullableString(last.message);
  if (text === null) {
    // A rejected tool call exits 0 with an empty final message.
    return { kind: "provider-failure", status: "child-failed", message: "devin ended with an empty final message", metadata: found };
  }
  return { kind: "complete", text, metadata: found };
}

function sidecar(facts: LaunchFacts): { readonly output: string; readonly config: string } {
  const paths = facts.providerSidecar;
  if (paths?.config == null) throw new Error("devin argv needs the lane's provider sidecar paths");
  return { output: paths.output, config: paths.config };
}

export const devin = adapter({
  id: "devin",
  executable: "devin",
  effortIn: "model-id",
  preflight: {
    argv: () => ["auth", "status"],
    retryAfterUnauthenticatedMs: null,
    // `devin auth status` exits 0 when logged out, so its first line decides.
    classify(run) {
      if (run.exitCode === 0 && /^Logged in \(via Devin\)\./.test(run.stdout)) {
        return { kind: "passed", evidence: "authenticated" };
      }
      return /^Not logged in\./.test(run.stdout) ? { kind: "unauthenticated" } : { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "file",
    sidecar: { output: "export.json", config: { name: "lockdown.json", content: `${JSON.stringify(LOCKDOWN, null, 2)}\n` } },
    // `--sandbox` forces Devin's autonomous mode, which lets shell commands write in the cwd while it
    // rejects the edit tools, so Devin has no bounded writer mode.
    supports: ["read-only"],
    // The lane bypasses workspace trust, so a repository's .devin/ hooks, permissions and MCP servers would load.
    projectConfigDir: ".devin",
    needsSharedGitDir: () => false,
    argv(lane, facts) {
      const paths = sidecar(facts);
      return [
        "-p",
        "--prompt-file",
        lane.promptPath,
        "--model",
        lane.cliModel,
        // Without --sandbox, auto mode's approval policy rejects edits and writing shell commands.
        "--permission-mode",
        "auto",
        // Print mode refuses an untrusted cwd otherwise.
        "--respect-workspace-trust",
        "false",
        "--export",
        paths.output,
        "--config",
        paths.config,
      ];
    },
  },
  parse: (run) => parse(run),
  proof: { report: "required", matches: (lane, reported) => reported === lane.cliModel },
  // No DEVIN_* prefix: DEVIN_PERMISSION_MODE, DEVIN_SANDBOX, DEVIN_MODEL and DEVIN_REFUSAL_FALLBACK
  // would widen the lane, change its model or add a model fallback.
  environment: () => ({ kind: "allowlist", names: BASE_ALLOWLIST, prefixes: BASE_PREFIXES }),
  docs: {
    name: "Devin CLI",
    hostPrerequisites: [],
    statePaths: ["`~/.local/share/devin/` (the login, which the CLI reads) and the config, telemetry and log files it writes under the home"],
    notes: [
      "Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort. An unregistered Devin model must be a CLI model ID with the `default` effort.",
      "Read-only only. A lane runs `--permission-mode auto` without `--sandbox`, so Devin's approval policy, not an OS sandbox, rejects edits and writing shell commands, as Claude's `plan` mode does. With `--sandbox`, approved shell commands write in the cwd while the edit tools are rejected, so no Devin mode is a bounded writer. The runner refuses an `isolated-write` lane before launch.",
      "The lane passes `--respect-workspace-trust false`, so the runner refuses a Devin lane whose cwd, or any parent up to the git root, holds `.devin/`: Devin would load that repository's hooks, permissions and MCP servers.",
      "Each lane gets a run-owned `--config` file in its private `<receipt>.provider/` directory (0700). It turns off subagents, every host rule source (such as `CLAUDE.md`) and MCP tools, and denies web search and the fetch tools. Devin still loads its own skills. Network isolation is not established: shell network access and the fetch denials were not measured.",
      "The preflight passes when `devin auth status` exits 0 and starts with `Logged in (via Devin).`. It also exits 0 when logged out, so output starting with `Not logged in.` is `unauthenticated`/77, and any other output is `child-failed`/70.",
      "The reply, session, token usage and model proof come from the `--export` ATIF file at `<receipt>.provider/export.json`, never from stdout. The proof is the last step's `extra.generation_model`, which must equal the CLI model ID. An empty final message, as after a rejected tool call, is `child-failed`/70. An interrupted response, or exit 143 after SIGTERM, is `cancelled`/130. `Error: Unknown model:` is `unavailable-model`/69.",
    ],
  },
});
