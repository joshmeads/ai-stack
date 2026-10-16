import { join } from "node:path";
import { adapter, type ChildRun, type Lane, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { modelFailureStatus, type NormalizedUsage } from "../types.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// By default dsh loads host and project rules and skills, offers web, subagent and workflow tools, writes a
// session title with a second model call, and uploads the whole session log and the plugin inventory with
// every request. Measured with dsh 0.2.0-rc.2.
const DISABLED_ROWS = [
  "agent-instructions",
  "skill-filesystem",
  "tool-skill",
  "tool-web",
  "web",
  "web-search-deepseek",
  "web-fetch-http",
  "tool-subagent",
  "tool-subagent-fork",
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-workflow",
  "workflow-ptc",
  "plugin-package-inventory-deepseek",
  "session-title-llm",
];

// A patch replaces a row's whole config, so each pinned row is complete. The user layer in
// ~/.dsh/profiles/headless/cordis.patch.yml applies before --patch, so every row that enforces the sandbox or
// approvals is pinned enabled with its full config. Pinning `sandbox-policy` and `approval` also overrides
// DSH_PERMISSION_MODE. JSON strings are YAML double-quoted scalars, so a path or model cannot be reinterpreted.
function patch(lane: Lane): string {
  const quoted = JSON.stringify;
  return [
    "- id: sandbox",
    "  disabled: false",
    "- id: sandbox-policy",
    "  disabled: false",
    "  config:",
    "    mode: read-only",
    `    workspaceRoot: ${quoted(lane.cwd)}`,
    "- id: bash-sandbox",
    "  disabled: false",
    "  config:",
    "    timeoutMs: 60000",
    "- id: fs-sandbox",
    "  disabled: false",
    "- id: approval",
    "  disabled: false",
    "  config:",
    "    policy: ask",
    "- id: permission",
    "  disabled: false",
    "  config:",
    "    presets:",
    "      read-only:",
    "        sandbox: read-only",
    "        approval: ask",
    "      workspace-write:",
    "        sandbox: workspace-write",
    "        approval: ask",
    "      danger-full-access:",
    "        sandbox: danger-full-access",
    "        approval: never",
    "- id: agent-default-model",
    "  config:",
    "    provider: deepseek-official",
    `    model: ${quoted(lane.cliModel)}`,
    ...(lane.effort === "default" ? [] : [`    reasoningEffort: ${quoted(lane.effort)}`]),
    ...DISABLED_ROWS.flatMap((id) => [`- id: ${id}`, "  disabled: true"]),
    "- id: session-log-deepseek",
    "  config:",
    "    enabled: false",
    "",
  ].join("\n");
}

const PREFLIGHT_PATCH = join(import.meta.dir, "dsh-preflight.yml");
const SIGINT_EXIT = 130;
const NO_METADATA: ProviderMetadata = { reportedModel: null, sessionId: null, usage: null, costUsd: null };

type Events = { readonly kind: "events"; readonly list: readonly JsonObject[] } | { readonly kind: "malformed" };

function events(stdout: string): Events {
  const list: JsonObject[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const event = object(JSON.parse(line));
      if (event !== null) list.push(event);
    } catch {
      return { kind: "malformed" };
    }
  }
  return { kind: "events", list };
}

function turnEnd(list: readonly JsonObject[]): JsonObject | null {
  const end = list.findLast((event) => event.type === "status" && event.phase === "turn_end");
  return end === undefined ? null : object(end.reason);
}

function errorCode(reason: JsonObject | null): string | null {
  return reason?.kind === "error" ? nullableString(object(reason.error)?.code) : null;
}

const USAGE_FIELDS = [
  ["inputTokens", "inputTokens"],
  ["outputTokens", "outputTokens"],
  ["totalTokens", "totalTokens"],
  ["cacheReadTokens", "cachedInputTokens"],
  ["cacheWriteTokens", "cacheCreationInputTokens"],
  ["reasoningTokens", "reasoningTokens"],
] as const;

// Each step reports its own usage, so the turn's usage is the sum over `step_end` events.
function usage(list: readonly JsonObject[]): NormalizedUsage | null {
  const sum: Partial<Record<keyof NormalizedUsage, number>> = {};
  for (const event of list) {
    if (event.type !== "status" || event.phase !== "step_end") continue;
    const step = object(event.usage);
    for (const [from, to] of USAGE_FIELDS) {
      const value = finiteNumber(step?.[from]);
      if (value !== undefined) sum[to] = (sum[to] ?? 0) + value;
    }
  }
  return Object.keys(sum).length === 0 ? null : sum;
}

function parse(run: ModelRun): ParseResult {
  if (run.exitCode === SIGINT_EXIT) {
    return { kind: "provider-failure", status: "cancelled", message: "dsh exited with status 130 after SIGINT", metadata: NO_METADATA };
  }
  const parsed = events(run.stdout);
  if (parsed.kind === "malformed") return { kind: "malformed", message: "dsh emitted a non-JSON event" };
  const metadata: ProviderMetadata = {
    reportedModel: null,
    sessionId: nullableString(parsed.list.find((event) => event.type === "session")?.sessionId),
    usage: usage(parsed.list),
    costUsd: null,
  };
  const reason = turnEnd(parsed.list);
  if (reason?.kind === "error") {
    // The run's nonzero exit lets run.ts read an unknown model from the same stderr line.
    if (modelFailureStatus(run.stderr) === "unavailable-model") return { kind: "malformed", message: "dsh named an unavailable model" };
    const error = object(reason.error);
    const message = `dsh turn failed: ${errorCode(reason) ?? "unknown code"}: ${nullableString(error?.message) ?? "no message"}`;
    return { kind: "provider-failure", status: "child-failed", message, metadata };
  }
  // SIGTERM exits 0 and still writes a `final` with the partial reply, but no `turn_end`.
  if (reason?.kind !== "completed") return { kind: "malformed", message: "dsh ended without a completed turn" };
  const text = nullableString(parsed.list.findLast((event) => event.type === "final")?.text);
  if (text === null) return { kind: "malformed", message: "dsh completed the turn without final text" };
  return { kind: "complete", text, metadata };
}

// dsh has no status command. The preflight turn's error code says only whether a key is stored or exported.
function classify(run: ChildRun) {
  const parsed = events(run.stdout);
  const code = parsed.kind === "events" ? errorCode(turnEnd(parsed.list)) : null;
  if (code === "TRANSPORT") return { kind: "passed", evidence: "credential present; not validated" } as const;
  return code === "MISSING_CREDENTIAL" ? { kind: "unauthenticated" } as const : { kind: "inconclusive" } as const;
}

export const dsh = adapter({
  id: "dsh",
  executable: "dsh",
  effortIn: "config",
  preflight: {
    // A positional task: the preflight gets no stdin.
    argv: () => ["--profile", "headless", "--patch", PREFLIGHT_PATCH, "--json", "preflight"],
    retryAfterUnauthenticatedMs: null,
    classify,
    // dsh ignores a patch row it does not have, so another version could drop the lockdown silently.
    version: { argv: ["--version"], expected: "0.2.0-rc.2" },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: "patch.yml", content: patch } },
    // The Seatbelt `workspace-write` writer waits for a writer route in the live gate.
    supports: ["read-only"],
    // dsh loads no project patch, hook or MCP file. It loads a cwd `.env` but refuses its bootstrap names.
    projectConfig: [],
    needsSharedGitDir: () => false,
    // Launcher flags must come before `--json`.
    argv: (_lane, facts) => {
      const config = facts.providerSidecar?.config;
      if (config == null) throw new Error("dsh argv needs the lane's patch path");
      return ["--profile", "headless", "--patch", config, "--json", "-"];
    },
  },
  parse: (run) => parse(run),
  // The stream carries no model, and the session log records the requested model whatever the server ran.
  proof: { report: "absent", matches: () => false },
  // No DSH_* name or other DEEPSEEK_* name: DSH_PERMISSION_MODE widens the lane, DSH_HOME and its kin change
  // what loads, and DEEPSEEK_BASE_URL redirects inference and the key with it.
  environment: () => ({ kind: "allowlist", names: [...BASE_ALLOWLIST, "DEEPSEEK_API_KEY"], prefixes: BASE_PREFIXES }),
  docs: {
    name: "DeepSeek Harness",
    hostPrerequisites: ["dsh 0.2.0-rc.2 exactly"],
    statePaths: [
      "`~/.dsh/`: the stored key `~/.dsh/.credentials.yaml`, which the CLI reads, and the sessions (`sessions/<cwd-slug>/<session-id>/`), projection cache (`storages/session_projcache/`), `profiles/headless/` and `.anonymous-user-id` it writes on every run",
    ],
    notes: [
      "Measured with dsh 0.2.0-rc.2, a developer preview. The runner checks `dsh --version` before the preflight and refuses any other version as `unavailable-cli`/69. Recheck on an upgrade: the config row IDs the patch names (dsh silently ignores a patch row it does not have, so a renamed row would drop that part of the lockdown), the SIGTERM exit 0 with a partial `final`, the hardcoded `/tmp` writable root, the session-log upload being on by default, the `.env` bootstrap-name refusal, and the transport retry row.",
      "Model and effort are config, not flags. Each lane gets a run-owned `--patch` file at `<receipt>.provider/patch.yml` (directory 0700, file 0600) that pins `agent-default-model` to provider `deepseek-official`, the lane's model and, unless the effort is `default`, its `reasoningEffort`. dsh offers efforts `off`, `low`, `high` and `max`, and fails `medium` locally.",
      "Read-only only. The patch pins `sandbox-policy` to `read-only` with the lane's cwd as the workspace root and `approval` to `ask`, which overrides `DSH_PERMISSION_MODE`. The user layer `~/.dsh/profiles/headless/cordis.patch.yml` applies before `--patch`, and the patch wins only for the rows it names, so it also pins `sandbox`, `bash-sandbox`, `fs-sandbox` and `permission`, and pins all six rows `disabled: false` with their full default config. Measured with `--dump-config`: a user layer that disabled `sandbox`, `sandbox-policy`, `bash-sandbox` and `fs-sandbox`, set `approval` to `never` and widened the `read-only` preset to `danger-full-access` composed to the pinned rows. The user layer can still change rows the patch does not name, and its file documents insert lists for new rows; whether an inserted row can widen a lane is not measured. Seatbelt enforces it on macOS for bash and the file tools. Headless has no approval channel, so an escalation request fails closed. Bash keeps network access, and the `read` tool is not confined to the cwd. The runner refuses an `isolated-write` lane before launch.",
      "The patch turns off host and project rules (`AGENTS.md`, `CLAUDE.md` and their local variants), every skill root, the web, subagent and workflow tools, the session-title model call, the plugin inventory and the `dsh_session_log` upload. The goal, job, todo, plan-mode and `read_image` tools still load. dsh loads no project patch, hook or MCP file, so no project path is refused.",
      "dsh loads the cwd's `.env`. It refuses bootstrap names there (`DSH_*`, `DEEPSEEK_BASE_URL`, `PATH`, `NODE_OPTIONS`, `XDG_*`, `DYLD_*`, proxies) and exits 1, so the runner does not refuse a `.env`. Its other values reach the bash tool. A `DEEPSEEK_API_KEY` there authenticates when none is stored or exported.",
      "dsh has no status command. The preflight is a turn with the shipped `providers/dsh-preflight.yml` patch, which points inference at a closed loopback port and turns off retries, the title call and the session-log upload. `TRANSPORT` passes with the fixed evidence `credential present; not validated`: it proves only that a key is stored or exported, not that the key works. `MISSING_CREDENTIAL` is `unauthenticated`/77, and any other output is `child-failed`/70.",
      "The reply is the `--json` stream's `final` text, accepted only after a `status` `turn_end` with `reason.kind` `completed`. SIGTERM exits 0 with a partial `final` and no `turn_end`, so that is `malformed-output`/65, never complete. Exit 130 after SIGINT is `cancelled`/130. A `turn_end` error is `child-failed`/70 with its code and message, except that DeepSeek's `The supported API model names are ...` refusal is `unavailable-model`/69. Usage sums the `step_end` usage; the session ID is the `session` event's. No cost is reported.",
      "No served model is reported, so the model proof is the pinned patch (`pinned-argv`).",
      "Server side: requests still carry the `x-deepseek-harness-user-id` and `x-deepseek-harness-session-id` headers. Whether DeepSeek keeps request content is not measured.",
    ],
  },
});
