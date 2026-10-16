import { isDeepStrictEqual } from "node:util";
import { adapter, type ChildRun, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, effortArgs, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

// The run-owned global config. `"*": "deny"` removes every tool the allow-list does not name from the model's tool
// list, so bash, edit, write, task, webfetch, websearch, skill and question are gone. Measured with OpenCode 1.19.1.
const READS = ["read", "glob", "grep", "list", "todowrite"];
const LOCKDOWN = {
  share: "disabled",
  autoupdate: false,
  snapshot: false,
  instructions: [],
  permission: { "*": "deny", ...Object.fromEntries(READS.map((tool) => [tool, "allow"])) },
};
const CONFIG_NAME = "opencode.json";
// What `opencode debug config --pure` prints for the lockdown alone, without `username`, on OpenCode 1.19.1.
const EFFECTIVE = { ...LOCKDOWN, $schema: "https://opencode.ai/config.json", agent: {}, mode: {}, plugin: [], command: {} };

// `opencode debug config --pure` prints the config merged from every layer, including a managed, remote, home or
// project config merged after OPENCODE_CONFIG. Any difference from the lockdown, such as an `mcp`, `lsp`, `plugin`,
// `provider` or `default_agent` key, or a default key a later OpenCode adds, refuses the lane.
function guard(run: ChildRun) {
  const refuse = (message: string) => ({ status: "child-failed", message }) as const;
  if (run.exitCode !== 0) return refuse(`\`opencode debug config --pure\` exited with status ${run.exitCode ?? "none"}`);
  let config: JsonObject | null = null;
  try {
    config = object(JSON.parse(run.stdout));
  } catch {
    config = null;
  }
  const { username, ...effective } = config ?? {};
  if (config === null || typeof username !== "string") {
    return refuse("`opencode debug config --pure` did not print one JSON object with a string `username`");
  }
  const differing = [...new Set([...Object.keys(EFFECTIVE), ...Object.keys(effective)])]
    .filter((key) => !isDeepStrictEqual(effective[key], (EFFECTIVE as JsonObject)[key]))
    .sort();
  if (differing.length === 0) return null;
  return refuse(`OpenCode's effective configuration differs from the supported read-only lockdown in ${differing.join(", ")} (\`opencode debug config --pure\`)`);
}

// SIGINT exits 130 and SIGTERM 143, each after only a step_start event.
const SIGNAL_EXITS = [130, 143];
const ANSI = /\u001b\[[0-9;]*m/g;

function events(stdout: string): JsonObject[] | null {
  const parsed: JsonObject[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let event: JsonObject | null;
    try {
      event = object(JSON.parse(line));
    } catch {
      return null;
    }
    if (event === null) return null;
    parsed.push(event);
  }
  return parsed;
}

function metadata(stream: readonly JsonObject[]): ProviderMetadata {
  const finishes = stream.filter((event) => event.type === "step_finish").map((event) => object(event.part));
  const sum = (read: (part: JsonObject | null) => unknown) =>
    finishes.reduce((total, part) => total + (finiteNumber(read(part)) ?? 0), 0);
  const tokens = (part: JsonObject | null) => object(part?.tokens);
  const costs = finishes.map((part) => finiteNumber(part?.cost)).filter((cost) => cost !== undefined);
  return {
    reportedModel: null,
    sessionId: stream.map((event) => nullableString(event.sessionID)).find((id) => id !== null) ?? null,
    usage: finishes.length === 0 ? null : {
      inputTokens: sum((part) => tokens(part)?.input),
      cachedInputTokens: sum((part) => object(tokens(part)?.cache)?.read),
      cacheCreationInputTokens: sum((part) => object(tokens(part)?.cache)?.write),
      outputTokens: sum((part) => tokens(part)?.output),
      reasoningTokens: sum((part) => tokens(part)?.reasoning),
      totalTokens: sum((part) => tokens(part)?.total),
    },
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
  };
}

function parse(run: ModelRun): ParseResult {
  const stream = events(run.stdout);
  const found = metadata(stream ?? []);
  if (run.exitCode !== null && SIGNAL_EXITS.includes(run.exitCode)) {
    return { kind: "provider-failure", status: "cancelled", message: `opencode exited with status ${run.exitCode} after a signal`, metadata: found };
  }
  if (stream === null) return { kind: "malformed", message: "opencode emitted a non-JSON event" };
  const error = stream.find((event) => event.type === "error");
  if (error !== undefined) {
    // An unknown model or provider reports only UnknownError here; the ERROR log line on stderr names the cause.
    const detail = object(error.error);
    const named = [nullableString(detail?.name), nullableString(object(detail?.data)?.message)].filter((part) => part !== null);
    return { kind: "provider-failure", status: "child-failed", message: `opencode reported ${named.join(": ") || "an error"}`, metadata: found };
  }
  const lastStart = stream.findLastIndex((event) => event.type === "step_start");
  const lastFinish = stream.findLastIndex((event) => event.type === "step_finish");
  if (lastFinish < 0 || lastFinish < lastStart) return { kind: "malformed", message: "opencode stream did not end with step_finish" };
  const reason = object(stream[lastFinish]!.part)?.reason;
  if (reason === "tool-calls") {
    // Headless OpenCode auto-rejects a permission prompt and ends the turn with no reply, at exit 0.
    return { kind: "provider-failure", status: "child-failed", message: "opencode ended on a rejected tool call", metadata: found };
  }
  if (reason !== "stop") {
    return { kind: "provider-failure", status: "child-failed", message: `opencode ended its last step with reason ${JSON.stringify(reason ?? null)}`, metadata: found };
  }
  const text = stream.slice(lastStart + 1)
    .filter((event) => event.type === "text")
    .map((event) => object(event.part)?.text)
    .filter((part): part is string => typeof part === "string")
    .join("");
  if (text.length === 0) return { kind: "malformed", message: "opencode's last step has no text" };
  return { kind: "complete", text, metadata: found };
}

export const opencode = adapter({
  id: "opencode",
  executable: "opencode",
  effortIn: "flag",
  preflight: {
    // Lists only providers with a usable credential, plus the free OpenCode Zen models.
    argv: (lane) => ["models", lane.model.split("/")[0]!],
    retryAfterUnauthenticatedMs: null,
    guard: { argv: ["debug", "config", "--pure"], check: guard },
    classify(run, lane) {
      if (!lane.model.includes("/")) return { kind: "unavailable-model" };
      if (run.exitCode === 0) {
        return run.stdout.split("\n").some((line) => line.trim() === lane.model)
          ? { kind: "passed", evidence: `model ${lane.model} listed` }
          : { kind: "unavailable-model" };
      }
      return /^Error: Provider not found:/m.test(run.stderr.replace(ANSI, "")) ? { kind: "unauthenticated" } : { kind: "inconclusive" };
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: { output: null, config: { name: CONFIG_NAME, content: () => `${JSON.stringify(LOCKDOWN, null, 2)}\n` } },
    // No OS sandbox: with external_directory denied, a shell write still escaped the cwd, so no mode is a bounded writer.
    supports: ["read-only"],
    // OPENCODE_DISABLE_PROJECT_CONFIG turns off opencode.json and AGENTS.md, but OpenCode 1.19.1 still imports
    // .opencode/plugins/*.js, which runs the module's top-level code, even with --pure.
    projectConfig: [".opencode/"],
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "run",
      "--pure",
      // A config's default_agent would otherwise pick another agent.
      "--agent",
      "build",
      "--format",
      "json",
      // Without a title, OpenCode calls a second model to name the session.
      "--title",
      "pstack-lane",
      // An unknown model's stdout is a generic UnknownError; the ERROR log line names the cause.
      "--print-logs",
      "--log-level",
      "ERROR",
      "-m",
      lane.cliModel,
      ...effortArgs(lane, ["--variant", lane.effort]),
    ],
  },
  parse: (run) => parse(run),
  proof: { report: "absent", matches: () => false },
  // OpenCode 1.19.1 reads the home .opencode/ (an opencode.json merged after OPENCODE_CONFIG, and plugins) under
  // OPENCODE_TEST_HOME when set, so the sidecar keeps the host's ~/.opencode/ out; stored logins still come from the
  // real home. No other OPENCODE_ prefix: OPENCODE_PERMISSION turned bash and edit back on over the lockdown, and
  // others replace the config or the model catalog. No provider key names: a lane uses OpenCode's stored logins or
  // a free Zen model.
  environment: (_access, sidecarDir) => ({
    kind: "allowlist",
    names: BASE_ALLOWLIST,
    prefixes: BASE_PREFIXES,
    set: {
      XDG_CONFIG_HOME: `${sidecarDir}`,
      OPENCODE_TEST_HOME: `${sidecarDir}`,
      OPENCODE_CONFIG: `${sidecarDir}/${CONFIG_NAME}`,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
  }),
  docs: {
    name: "OpenCode",
    hostPrerequisites: [],
    statePaths: [
      "`~/.local/share/opencode/` (`auth.json`, the stored logins, which the CLI reads; the session database, logs and tool output it writes)",
      "`~/.local/state/opencode/`, `$XDG_CACHE_HOME/opencode/` and `$TMPDIR/opencode/`, which it writes",
    ],
    notes: [
      "The model is `provider/model`, such as `opencode/deepseek-v4.1-flash-free`. The effort is `--variant <effort>`, omitted for `default`. OpenCode accepts an unknown variant silently, so only a registered family's efforts are checked.",
      "Read-only only, measured on OpenCode 1.19.1. Each lane runs the `build` agent (`--agent build`, because a config's `default_agent` would otherwise pick another agent) with a run-owned config whose `\"*\": \"deny\"` permission removes every tool except `read`, `glob`, `grep`, `list` and `todowrite` from the model's tool list. OpenCode's permission policy enforces this, not an OS sandbox. With `external_directory` denied, a shell write still escaped the cwd, so no OpenCode mode is a bounded writer, and the runner refuses an `isolated-write` lane before launch.",
      "The runner writes that config to `<receipt>.provider/opencode.json` (0600, in a 0700 directory), points `OPENCODE_CONFIG` at it, and sets `XDG_CONFIG_HOME` and `OPENCODE_TEST_HOME` to the directory, so OpenCode reads the run-owned directory in place of the host's `~/.config/opencode/` and `~/.opencode/`. OpenCode 1.19.1 merges `~/.opencode/opencode.json` after `OPENCODE_CONFIG` and imports `~/.opencode/plugins/*.js` even with `--pure`, and it finds that home `.opencode/` through `OPENCODE_TEST_HOME` when set. Measured with a fresh `HOME` whose `.opencode/opencode.json` allowed `bash`, `edit` and `write` and whose `.opencode/plugins/` held a canary plugin: without `OPENCODE_TEST_HOME`, `opencode debug agent build` listed those tools and the canary ran, and neither `OPENCODE_CONFIG_CONTENT` nor `OPENCODE_CONFIG_DIR` changed that; with it, `debug agent build` and `debug config` showed only the lockdown, the canary did not run, and a lane asked to write and edit files changed nothing. Stored logins still come from the real home. `OPENCODE_DISABLE_PROJECT_CONFIG=1` stops the repository's `opencode.json`, `opencode.jsonc`, `.opencode/` agents and commands, and `AGENTS.md` from loading. `OPENCODE_DISABLE_CLAUDE_CODE=1` stops `~/.claude/CLAUDE.md` and `~/.claude/skills`, and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` stops `~/.agents/skills`. `OPENCODE_DISABLE_AUTOUPDATE=1` and `--pure` turn off updates and external plugins. The built-in `customize-opencode` skill remains, but the `skill` tool is denied.",
      "The runner refuses an OpenCode lane whose cwd, or any parent up to the git root (or `/` outside a repository), holds `.opencode/`. Even with `--pure` and `OPENCODE_DISABLE_PROJECT_CONFIG=1`, OpenCode 1.19.1 imports `.opencode/plugins/*.js`, which runs each module's top-level code; only the plugin's initialization is skipped. Under the home directory, the lane runs only inside a git repository rooted below it, because the CLI's own walk would otherwise reach the home directory's config.",
      "Before the preflight, the runner runs `opencode debug config --pure` with the lane's environment and cwd. It prints the configuration OpenCode merges from every layer it loads, including remote layers, a managed config (`/Library/Application Support/opencode/` on macOS, `/etc/opencode/` on Linux) and a home or project config, several of which merge after `OPENCODE_CONFIG` and override it. The runner refuses the lane as `child-failed`/70 unless the command exits 0, its output is one JSON object with a string `username`, and that object without `username` equals the lockdown plus the defaults OpenCode 1.19.1 adds (`$schema`, and empty `agent`, `mode`, `plugin` and `command`). Key order does not matter; every other key, value and array entry must match. So a layer that adds MCP servers (`mcp`), LSP servers (`lsp`, including `true`), plugins (`plugin`, `plugin_origins`), provider routing (`provider`), a `default_agent` or an agent change (`agent`) refuses the lane. The message names the differing top-level keys, never their values, the receipt keeps the printed configuration as evidence, and the preflight stays `not-run`. A later OpenCode that adds a default key is refused until the adapter is measured against it. Measured with OpenCode 1.19.1 and planted layers through the binary's `OPENCODE_TEST_MANAGED_CONFIG_DIR` redirect and a fake well-known login: a managed MCP server, LSP command, provider `baseURL` and `agent.build` prompt each changed or ran in a real lane, and the check refused each of them, a plugin, `default_agent`, `lsp: true` and the well-known layer, without starting any planted MCP server, LSP command or plugin.",
      "Remote layers are fetched, not blocked. A `wellknown` login (from `opencode providers login <url>`) or an active console organization (from `opencode console login`) makes OpenCode fetch remote config on every check and again in every lane. The check sees that content at check time only, so the server can change it before the lane starts. Neither layer existed on the measured Mac. The well-known layer was measured with a fake login and a local server. The console organization layer was not measured.",
      "On macOS, `/Library/Managed Preferences/<user>/ai.opencode.managed.plist` and `/Library/Managed Preferences/ai.opencode.managed.plist` merge last. OpenCode's source merges them into the same configuration that `debug config` prints, so the check should see them. This was not measured on a managed Mac.",
      "Every lane, even with `--pure`, downloads OpenCode's plugin SDK (`@opencode-ai/plugin`) and its dependencies from registry.npmjs.org into `<receipt>.provider/opencode/node_modules/`, with install scripts ignored.",
      "The child environment drops every other `OPENCODE_*` variable, because `OPENCODE_PERMISSION` turns `bash` and `edit` back on and others replace the config or the model catalog. It also drops provider keys such as `OPENROUTER_API_KEY`. A lane authenticates only through OpenCode's stored logins (`opencode auth login`, kept in `~/.local/share/opencode/auth.json`), or uses a free OpenCode Zen model, which needs no login.",
      "The preflight runs `opencode models <provider>`, where `<provider>` is the model's part before the first `/`. It passes when it exits 0 and one line equals the model. `Error: Provider not found:` with a nonzero exit is `unauthenticated`/77. Exit 0 without the model line is `unavailable-model`/69, and so is a model with no `/`. Any other output is `child-failed`/70.",
      "The lane passes `--title pstack-lane`, because without a title OpenCode calls a second model to name the session. The prompt goes on stdin.",
      "The reply, session ID, token usage and cost come from the `--format json` event stream on stdout. A lane is complete only when the last `step_finish` has reason `stop` and a `text` event follows the last `step_start`; the reply is those texts in order. Usage and cost are summed over every `step_finish`. An `error` event is `child-failed`/70. For an unknown model that event says only `UnknownError`, and `--print-logs --log-level ERROR` puts its `ProviderModelNotFoundError` cause on stderr, which the receipt keeps. A final `step_finish` with reason `tool-calls` is a permission prompt that headless OpenCode auto-rejected at exit 0, and is `child-failed`/70. Exit 130 or 143 after a signal is `cancelled`/130.",
      "No event names the served model, so the model proof is the pinned argv (`pinned-argv`).",
      "Sessions stay in the local session database. The config turns sharing off, and OpenCode 1.19.1 keeps no server-side session record.",
    ],
  },
});
