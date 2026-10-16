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
// OpenCode appends this allow to every agent so its tools can read their own truncated output.
const TOOL_OUTPUT = "/opencode/tool-output/*";

// `opencode debug agent build` prints the build agent's merged ruleset from every config layer, including a
// managed, home, project or account config merged after OPENCODE_CONFIG. OpenCode applies the last rule that
// matches both the tool and the pattern, so nothing before the last `"*"` deny for `"*"` can allow anything.
function guard(run: ChildRun) {
  let agent: JsonObject | null = null;
  try {
    agent = run.exitCode === 0 ? object(JSON.parse(run.stdout)) : null;
  } catch {
    agent = null;
  }
  const rules = Array.isArray(agent?.permission) ? agent.permission.map((rule) => object(rule)) : [null];
  const readable = rules.flatMap((rule) =>
    typeof rule?.permission === "string" && typeof rule.pattern === "string" && typeof rule.action === "string"
      ? [{ permission: rule.permission, pattern: rule.pattern, action: rule.action }]
      : []);
  if (readable.length === 0 || readable.length !== rules.length) {
    return { status: "child-failed", message: "`opencode debug agent build` did not print a readable permission ruleset" } as const;
  }
  const base = readable.findLastIndex((rule) => rule.permission === "*" && rule.pattern === "*");
  const wider = base < 0 || readable[base]!.action !== "deny"
    ? [`"*" ${base < 0 ? "(no rule)" : readable[base]!.action}`]
    : readable.slice(base + 1)
      .filter((rule) => rule.action !== "deny" && !READS.includes(rule.permission))
      .filter((rule) => !(rule.permission === "external_directory" && rule.action === "allow" && rule.pattern.endsWith(TOOL_OUTPUT)))
      .map((rule) => `${rule.permission} ${JSON.stringify(rule.pattern)} ${rule.action}`);
  if (wider.length === 0) return null;
  return {
    status: "child-failed",
    message: `OpenCode's effective permissions are wider than the read-only lockdown (${wider.join(", ")}); a managed, home, project or account config overrides the lane's lockdown`,
  } as const;
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
    guard: { argv: ["debug", "agent", "build", "--pure"], check: guard },
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
      // A config's default_agent would otherwise pick an agent the guard did not check.
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
      "Read-only only. Each lane runs the `build` agent (`--agent build`, because a config's `default_agent` would otherwise pick another agent) with a run-owned config whose `\"*\": \"deny\"` permission removes every tool except `read`, `glob`, `grep`, `list` and `todowrite` from the model's tool list. OpenCode's permission policy enforces this, not an OS sandbox. With `external_directory` denied, a shell write still escaped the cwd, so no OpenCode mode is a bounded writer, and the runner refuses an `isolated-write` lane before launch.",
      "The runner writes that config to `<receipt>.provider/opencode.json` (0600, in a 0700 directory), points `OPENCODE_CONFIG` at it, and sets `XDG_CONFIG_HOME` and `OPENCODE_TEST_HOME` to the directory, so the host's global OpenCode config, plugins and MCP servers do not load. OpenCode 1.19.1 merges `~/.opencode/opencode.json` after `OPENCODE_CONFIG` and imports `~/.opencode/plugins/*.js` even with `--pure`, and it finds that home `.opencode/` through `OPENCODE_TEST_HOME` when set. Measured with a fresh `HOME` whose `.opencode/opencode.json` allowed `bash`, `edit` and `write` and whose `.opencode/plugins/` held a canary plugin: without `OPENCODE_TEST_HOME`, `opencode debug agent build` listed those tools and the canary ran, and neither `OPENCODE_CONFIG_CONTENT` nor `OPENCODE_CONFIG_DIR` changed that; with it, `debug agent build` and `debug config` showed only the lockdown, the canary did not run, and a lane asked to write and edit files changed nothing. Stored logins still come from the real home. `OPENCODE_DISABLE_PROJECT_CONFIG=1` stops the repository's `opencode.json`, `opencode.jsonc`, `.opencode/` agents and commands, and `AGENTS.md` from loading. `OPENCODE_DISABLE_CLAUDE_CODE=1` stops `~/.claude/CLAUDE.md` and `~/.claude/skills`, and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` stops `~/.agents/skills`. `OPENCODE_DISABLE_AUTOUPDATE=1` and `--pure` turn off updates and external plugins. The built-in `customize-opencode` skill remains, but the `skill` tool is denied.",
      "The runner refuses an OpenCode lane whose cwd, or any parent up to the git root (or `/` outside a repository), holds `.opencode/`. Even with `--pure` and `OPENCODE_DISABLE_PROJECT_CONFIG=1`, OpenCode 1.19.1 imports `.opencode/plugins/*.js`, which runs each module's top-level code; only the plugin's initialization is skipped. Under the home directory, the lane runs only inside a git repository rooted below it, because the CLI's own walk would otherwise reach the home directory's config.",
      "Before the preflight, the runner runs `opencode debug agent build --pure` with the lane's environment and cwd. It prints the build agent's permission ruleset merged from every config layer, including a managed (`/Library/Application Support/opencode/` or a managed-preferences profile on macOS, `/etc/opencode/` on Linux), home, project or account config that OpenCode merges after `OPENCODE_CONFIG`. OpenCode applies the last rule that matches both the tool and the pattern. The runner refuses the lane as `child-failed`/70 unless the last rule for tool `\"*\"` and pattern `\"*\"` denies, and every rule after it denies, names `read`, `glob`, `grep`, `list` or `todowrite`, or is OpenCode's own `external_directory` allow for its `tool-output/` directory. Output the runner cannot read is also a refusal. The message names each wider rule, the receipt keeps the printed ruleset as evidence, and the preflight stays `not-run`. Measured with OpenCode 1.19.1 and a managed config that allowed `bash` and `edit`, planted through the binary's `OPENCODE_TEST_MANAGED_CONFIG_DIR` redirect: `debug config` and `debug agent build` reported both rules, and the runner refused the lane after only the guard call. An account config was not measured. The guard covers it only if `debug agent build` loads it as `run` does.",
      "The child environment drops every other `OPENCODE_*` variable, because `OPENCODE_PERMISSION` turns `bash` and `edit` back on and others replace the config or the model catalog. It also drops provider keys such as `OPENROUTER_API_KEY`. A lane authenticates only through OpenCode's stored logins (`opencode auth login`, kept in `~/.local/share/opencode/auth.json`), or uses a free OpenCode Zen model, which needs no login.",
      "The preflight runs `opencode models <provider>`, where `<provider>` is the model's part before the first `/`. It passes when it exits 0 and one line equals the model. `Error: Provider not found:` with a nonzero exit is `unauthenticated`/77. Exit 0 without the model line is `unavailable-model`/69, and so is a model with no `/`. Any other output is `child-failed`/70.",
      "The lane passes `--title pstack-lane`, because without a title OpenCode calls a second model to name the session. The prompt goes on stdin.",
      "The reply, session ID, token usage and cost come from the `--format json` event stream on stdout. A lane is complete only when the last `step_finish` has reason `stop` and a `text` event follows the last `step_start`; the reply is those texts in order. Usage and cost are summed over every `step_finish`. An `error` event is `child-failed`/70. For an unknown model that event says only `UnknownError`, and `--print-logs --log-level ERROR` puts its `ProviderModelNotFoundError` cause on stderr, which the receipt keeps. A final `step_finish` with reason `tool-calls` is a permission prompt that headless OpenCode auto-rejected at exit 0, and is `child-failed`/70. Exit 130 or 143 after a signal is `cancelled`/130.",
      "No event names the served model, so the model proof is the pinned argv (`pinned-argv`).",
      "Sessions stay in the local session database. The config turns sharing off, and OpenCode 1.19.1 keeps no server-side session record.",
    ],
  },
});
