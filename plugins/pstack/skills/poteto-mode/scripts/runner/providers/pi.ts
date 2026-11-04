import { adapter, type Lane, type ModelRun, type ParseResult, type ProviderMetadata } from "../registry/contract.ts";
import { BASE_ALLOWLIST, BASE_PREFIXES, effortArgs, finiteNumber, nullableString, object, type JsonObject } from "./shared.ts";

const OPENROUTER = "openrouter/";
const READ_TOOLS = "read,grep,find,ls";
const SIGNAL_EXITS = [130, 143];

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

function assistantMessages(stream: readonly JsonObject[]): JsonObject[] {
  return stream
    .filter((event) => event.type === "message_end")
    .map((event) => object(event.message))
    .filter((message): message is JsonObject => message?.role === "assistant");
}

function metadata(stream: readonly JsonObject[]): ProviderMetadata {
  const messages = assistantMessages(stream);
  const usages = messages.map((message) => object(message.usage));
  const sum = (read: (usage: JsonObject | null) => unknown) =>
    usages.reduce((total, usage) => total + (finiteNumber(read(usage)) ?? 0), 0);
  const costs = usages.map((usage) => finiteNumber(object(usage?.cost)?.total)).filter((cost) => cost !== undefined);
  return {
    reportedModel: nullableString(messages.at(-1)?.responseModel ?? (messages.at(-1)?.stopReason === "stop" ? messages.at(-1)?.model : null)),
    sessionId: nullableString(stream.find((event) => event.type === "session")?.id),
    usage: usages.length === 0 ? null : {
      inputTokens: sum((usage) => usage?.input),
      cachedInputTokens: sum((usage) => usage?.cacheRead),
      cacheCreationInputTokens: sum((usage) => usage?.cacheWrite),
      outputTokens: sum((usage) => usage?.output),
      reasoningTokens: sum((usage) => usage?.reasoning),
      totalTokens: sum((usage) => usage?.totalTokens),
    },
    costUsd: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
  };
}

function replyText(message: JsonObject): string {
  const content = Array.isArray(message.content) ? message.content : [];
  return content.map((part) => object(part))
    .filter((part) => part?.type === "text")
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function parse(run: ModelRun): ParseResult {
  const stream = events(run.stdout);
  const found = metadata(stream ?? []);
  if (run.exitCode !== null && SIGNAL_EXITS.includes(run.exitCode)) {
    return { kind: "provider-failure", status: "cancelled", message: `pi exited with status ${run.exitCode} after a signal`, metadata: found };
  }
  if (stream === null) return { kind: "malformed", message: "pi emitted a non-JSON event" };
  const last = assistantMessages(stream).at(-1);
  if (last === undefined) return { kind: "malformed", message: "pi stream did not contain an assistant message" };
  const settled = stream.findLast((event) => event.type === "agent_settled");
  if (settled === undefined) return { kind: "malformed", message: "pi stream did not end with agent_settled" };
  if (settled.aborted === true || last.stopReason === "aborted") {
    return { kind: "provider-failure", status: "cancelled", message: "pi reported the run was aborted", metadata: found };
  }
  if (last.stopReason === "error") {
    const message = nullableString(last.errorMessage) ?? "pi reported a provider error";
    return { kind: "provider-failure", status: "child-failed", message, metadata: found };
  }
  if (last.stopReason !== "stop") {
    return { kind: "provider-failure", status: "child-failed", message: `pi ended its last turn with reason ${JSON.stringify(last.stopReason ?? null)}`, metadata: found };
  }
  const text = replyText(last);
  if (text.length === 0) return { kind: "malformed", message: "pi's last message has no text" };
  return { kind: "complete", text, metadata: found };
}

function servedBy(lane: Lane, reported: string): boolean {
  const id = lane.cliModel.slice(OPENROUTER.length);
  if (id.startsWith("openrouter/")) return true;
  if (id.startsWith("~")) return reported.startsWith(`${id.slice(1).split("/")[0]!}/`);
  return reported === id;
}

export const pi = adapter({
  id: "pi",
  executable: "pi",
  effortIn: "flag",
  preflight: {
    argv: (lane) => ["--list-models", lane.cliModel],
    retryAfterUnauthenticatedMs: null,
    classify(run, lane) {
      if (!lane.cliModel.startsWith(OPENROUTER) || lane.effort === "ultra") return { kind: "unavailable-model" };
      if (run.exitCode !== 0) return { kind: "inconclusive" };
      if (run.stdout.startsWith("No models available.")) return { kind: "unauthenticated" };
      if (run.stdout.startsWith("No models matching ")) return { kind: "unavailable-model" };
      if (!run.stdout.startsWith("provider ")) return { kind: "inconclusive" };
      const listed = run.stdout.split("\n").slice(1).some((line) => {
        const [provider, model] = line.trim().split(/\s+/);
        return `${provider}/${model}` === lane.cliModel;
      });
      return listed ? { kind: "passed", evidence: `model ${lane.cliModel} listed; key not validated` } : { kind: "unavailable-model" };
    },
  },
  launch: {
    prompt: "stdin",
    sidecar: null,
    supports: ["read-only"],
    needsSharedGitDir: () => false,
    argv: (lane) => [
      "-p",
      "--mode",
      "json",
      "--no-session",
      "--tools",
      READ_TOOLS,
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-approve",
      "--model",
      lane.cliModel,
      ...effortArgs(lane, ["--thinking", lane.effort]),
    ],
  },
  parse: (run) => parse(run),
  proof: {
    report: "required",
    matches: servedBy,
  },
  environment: () => ({
    kind: "allowlist",
    names: [...BASE_ALLOWLIST, "OPENROUTER_API_KEY", "PI_CODING_AGENT_DIR"],
    prefixes: BASE_PREFIXES,
    set: { PI_OFFLINE: "1", PI_TELEMETRY: "0" },
  }),
  docs: {
    name: "pi",
    hostPrerequisites: [],
    statePaths: [
      "`~/.pi/agent/` (or an inherited `PI_CODING_AGENT_DIR`): the lane reads `auth.json`, `settings.json`, `models.json` and the model catalog there, and takes transient lock directories. Measured: no file under it changed in a real lane, and no session file appeared",
    ],
    notes: [
      "Measured with pi 1.4.0. A lane seats any OpenRouter model on this one adapter. The model is `openrouter/<id>`, and a rolling ID such as `openrouter/~google/gemini-pro-latest` resolves to the provider's latest model. The preflight refuses a model outside `openrouter/` as `unavailable-model`/69, because the allowlist passes only OpenRouter's key. An unregistered ID runs unchanged at any effort except `ultra`, which pi does not have: `--thinking ultra` only warns and runs at the default level, so the preflight refuses it as `unavailable-model`/69.",
      "The effort is `--thinking <effort>`, omitted for `default`. Pi clamps a level the model does not offer, so a receipt's effort is the level asked for.",
      "Read-only only. A lane runs `-p --mode json --no-session --tools read,grep,find,ls --no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes --no-approve` with the prompt on stdin. Pi's tool allowlist enforces this, not an OS sandbox, and pi has no bounded write mode, so the runner refuses an `isolated-write` lane before launch.",
      "Containment, measured with real lanes on the Grok and Gemini rolling IDs in a temporary git repository. Asked to create a file, run a shell command, call `web_search` and edit `AGENTS.md`, both models reported those tools unavailable, and the repository, `~/.pi/agent/sessions` and the rest of `~/.pi/agent` were unchanged. A request capture showed the tool list as exactly `read`, `grep`, `find`, `ls`. A local fake model that forced calls to `bash`, `write`, `edit` and `web_search` got `Tool <name> not found` for each, and nothing ran.",
      "`read` is not confined to the cwd: both models read a file outside the repository. A lane can read anything the user can, including `~/.pi/agent/auth.json`. It has no shell or network tool, but a measured lane's read file went to the model provider in its next request, so treat anything it can read as sent to the provider.",
      "Repository configuration does not load. With `--no-approve`, planted `.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions/`, `.pi/skills/`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md` and a root `.mcp.json` all stayed out. With `--approve` as the control, the extension and MCP server ran and the prompts loaded.",
      "The lane passes no `--no-context-files`, so a repository review reads the project's rules: `AGENTS.md` loads from the cwd and each parent directory, and a directory with both uses `AGENTS.md` over `CLAUDE.md`. Treat those files as the same untrusted input as any file in the repository.",
      "A lane reads the operator's real agent directory, because that is where `pi` stores its login and no setting moves `auth.json` on its own. A run-owned `PI_CODING_AGENT_DIR` found no key on the measured Mac, where the OpenRouter key is in `auth.json` and not in the environment. With the lane's flags, extensions, packages and MCP servers planted in an agent directory did not run, as a control without the flags showed they would. The directory's `AGENTS.md` and `APPEND_SYSTEM.md` still load, and its `models.json` can reroute a provider, as a measurement here used it to. `--no-session` is what keeps a lane out of the operator's sessions.",
      "The environment is an allowlist that adds `OPENROUTER_API_KEY` and `PI_CODING_AGENT_DIR`, and sets `PI_OFFLINE=1` and `PI_TELEMETRY=0`, which turn off pi's automatic network activity, such as the catalog refresh, and its telemetry and attribution headers. No other `PI_` name or provider key passes. A stored `auth.json` key takes precedence over the variable. Offline, the model list is the cached catalog, so run `pi update --models` when a new ID is missing from it.",
      "The preflight runs `pi --list-models <model>`, and it exits 0 in every measured case. A row whose `provider/model` equals the model passes, with the fixed evidence `model <id> listed; key not validated`. It proves that a key is present and the catalog lists the model, not that the key works or has credits: an invalid key passes. `No models available.` is `unauthenticated`/77. `No models matching` is `unavailable-model`/69, and that includes a host with another provider's login and no OpenRouter key. Any other output is `child-failed`/70. A model the catalog does not list is refused here, even though pi would send it as a custom ID.",
      "The reply, session ID, token usage and cost come from the `--mode json` stream on stdout. A lane is complete only when the stream has `agent_settled` and the last assistant `message_end` has `stopReason` `stop` and text; the reply is that message's text parts, without thinking parts. Usage and cost are summed over every assistant message. A provider error exits 0 with `stopReason` `error`, so an invalid key (`401`) or a model OpenRouter refuses (`400`) is `child-failed`/70 with its text. Running out of credits was not measured and takes the same path. No key at launch exits 1 with `No API key found` on stderr, and an empty prompt exits 0 with only the session header, and each ends without a complete reply. SIGTERM exits 143 and SIGINT exits 130, each `cancelled`/130 even when the stream looks finished.",
      "The model proof is the stream's `responseModel`, such as `x-ai/...` for `~x-ai/grok-latest`. The receipt keeps it as `reportedModel`, so a rolling ID's receipt says which model served it. A rolling `~vendor/...` ID must report that vendor, because it never equals the model it resolves to. An `openrouter/openrouter/...` router ID can serve any vendor, so it accepts any report. A concrete ID must equal the report exactly: no measured stream shows a variant suffix such as `:free` added or dropped, so none is allowed. A real stream for a concrete ID (`x-ai/grok-4.7`) carried no `responseModel`, so the report falls back to the message's `model`. That field repeats the request, so for a concrete ID the proof is about as strong as a pinned argv. A mismatch is `malformed-output`/65 with no output file.",
    ],
  },
});
