<!-- Generated from registry/models.ts and registry/providers.ts; do not edit. Run `bun runner/registry/render.ts --write` from plugins/pstack/skills/poteto-mode/scripts. -->

# Model catalog

Model and provider facts for [`provider-dispatch.md`](provider-dispatch.md), which holds the dispatch rules.

## Model matrix

| Family | Label | Provider | Model | Default effort | Selectable efforts | Claude-native agents | Status | Upstream pstack choice |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fable | Fable | claude | fable | max | low medium high xhigh max | `pstack-fable-<effort>` | optional | - |
| sol | GPT-6.1 Sol | codex | gpt-6.1-sol | max | low medium high xhigh max ultra | - | default | gpt-5.6-sol-max |
| grok | Grok 4.7 | grok | grok-4.7 | xhigh | low medium high xhigh max | - | default | grok-4.7-xhigh-fast |
| opus | Opus | claude | opus | max | low medium high xhigh max | `pstack-opus-<effort>` | default | opus |
| luna | GPT-6 Luna | codex | gpt-6-luna | max | low medium high xhigh max | - | optional | - |
| sonnet | Sonnet | claude | sonnet | max | low medium high xhigh max | `pstack-sonnet-<effort>` | optional | - |
| opus-5-5 | Opus 5.5 | claude | claude-opus-5-5 | max | low medium high xhigh max | `pstack-opus-5-5-<effort>` | optional | claude-opus-5-5-xhigh |
| swe-2 | SWE-2 | devin | swe-2 | max | medium high max | - | optional | - |
| swe-1.6 | SWE-1.6 | devin | swe-1.6 | default | default | - | optional | - |
| deepseek-v4.1-flash-free | DeepSeek V4.1 Flash (OpenCode Zen) | opencode | opencode/deepseek-v4.1-flash-free | max | low high max | - | optional | - |
| deepseek-flash | DeepSeek Flash (dsh) | dsh | deepseek-flash | max | low high max | - | optional | - |
| deepseek-v4-pro | DeepSeek V4 Pro (dsh) | dsh | deepseek-v4-pro | max | low high max | - | optional | - |
| amp-deepseek-v4.1-flash | DeepSeek V4.1 Flash (Amp) | amp | deepseek-v4.1-flash | default | default | - | optional | - |
| gemini-3.8-flash | Gemini 3.8 Flash (Antigravity) | agy | gemini-3.8-flash | high | low medium high | - | optional | - |
| composer-2.5 | Composer 2.5 (Cursor) | cursor | composer-2.5 | default | default | - | optional | - |
| gemini-3.7-flash | Gemini 3.7 Flash (Cursor) | cursor | gemini-3.7-flash | high | high | - | optional | - |

A family is `default` when a role default names it and `optional` otherwise. A Claude-native agent exists for each selectable effort of a Claude family.

Effort in the model ID: for these families the effort selects the CLI model, and argv carries no effort flag.

| Family | Effort | CLI model |
| --- | --- | --- |
| swe-2 | medium | `swe-2-medium` |
| swe-2 | high | `swe-2-high` |
| swe-2 | max | `swe-2-max` |
| swe-1.6 | default | `swe-1-6` |
| amp-deepseek-v4.1-flash | default | `deepseek-v4.1-flash` |
| gemini-3.8-flash | low | `gemini-3.8-flash-low` |
| gemini-3.8-flash | medium | `gemini-3.8-flash-medium` |
| gemini-3.8-flash | high | `gemini-3.8-flash-high` |
| composer-2.5 | default | `composer-2.5` |
| gemini-3.7-flash | high | `gemini-3.7-flash-high` |

## Kept predecessors and normalization

| Provider | Kept model | Family | Current model | Selectable efforts |
| --- | --- | --- | --- | --- |
| codex | gpt-5.6-sol | sol | gpt-6.1-sol | low medium high xhigh max ultra |
| grok | grok-4.6 | grok | grok-4.7 | low medium high xhigh max |

Rolling aliases:

| Family | Alias | Versioned predecessor |
| --- | --- | --- |
| fable | `fable` | `claude-fable-<revision>`, where the revision contains only digits and hyphens |
| opus | `opus` | `claude-opus-<revision>`, where the revision contains only digits and hyphens |
| sonnet | `sonnet` | `claude-sonnet-<revision>`, where the revision contains only digits and hyphens |

## Routes

| Provider | Claude Code parent | Codex parent | Access modes | Prompt | Model proof | Child environment | Host prerequisites |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude | native `Agent` | external runner | `read-only`, `isolated-write` | stdin | provider report | read-only: inherited; isolated-write: inherited without `GIT_*` | - |
| codex | external runner | native `spawn_agent` | `read-only`, `isolated-write`, `isolated-write-full-access` | stdin | pinned argv | inherited | - |
| grok | external runner | external runner | `read-only`, `isolated-write` | file | provider report | allowlist | Linux: Landlock and `bwrap` |
| devin | external runner | external runner | `read-only` | file | provider report | allowlist | - |
| opencode | external runner | external runner | `read-only` | stdin | pinned argv | allowlist | - |
| dsh | external runner | external runner | `read-only` | stdin | pinned argv | allowlist | dsh 0.2.0-rc.2 exactly |
| amp | external runner | external runner | `read-only` | stdin | pinned argv | allowlist | - |
| agy | external runner | external runner | `read-only` | stdin | pinned argv | allowlist | - |
| cursor | external runner | external runner | `read-only` | stdin | pinned argv | allowlist | - |

The runner refuses an access mode outside a provider's Access modes cell before launch. `isolated-write-full-access` is a writer capability, not a `--mode` value: the runner takes it as `--mode isolated-write --writer-sandbox full-access`, which a parent passes only when the model sheet opts in, as [`provider-dispatch.md`](provider-dispatch.md#codex-writer-sandbox) says.

## Provider notes

### claude: Claude Code CLI

- Executable: `claude`.
- Host prerequisites: none.
- State paths: the Claude config home (`CLAUDE_CONFIG_DIR`, else `~/.claude`).
- Child environment: read-only: inherited; isolated-write: inherited without `GIT_*`.

### codex: Codex CLI

- Executable: `codex`.
- Host prerequisites: none.
- State paths: the Codex home (`CODEX_HOME`, else `~/.codex`).
- Child environment: inherited.

### grok: Grok Build CLI

- Executable: `grok`.
- Host prerequisites: Linux: Landlock and `bwrap`.
- State paths: `~/.grok/`, which the CLI writes (for example `~/.grok/managed_config.toml`).
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS`, and variables starting with `LC_`, `XDG_`, `GROK_`, `XAI_`.
- `fast` is part of Cursor's Grok selector, not a Grok Build CLI model or effort flag.
- The preflight passes when `grok models` reports a login (`logged in`, `You are using XAI_API_KEY.`, or `You are authenticated via deployment key.`) and lists the lane's model on a line under `Available models:`. A model named only above that header, such as on the `Default model:` line, or output without the header, is `unavailable-model`/69.
- The authentication preflight has one bounded retry. If the first `grok models` result would be classified as unauthenticated, the runner waits five seconds and tries the same preflight once more. A second failure is terminal. The delay and second attempt share the runner's absolute deadline and cancellation latch, and the receipt keeps evidence from both attempts. Model execution is never retried.

### devin: Devin CLI

- Executable: `devin`.
- Host prerequisites: none.
- State paths: `~/.local/share/devin/` (the login, which the CLI reads) and the config, telemetry and log files it writes under the home.
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS`, and variables starting with `LC_`, `XDG_`.
- Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort. An unregistered Devin model must be a CLI model ID with the `default` effort.
- Read-only only. A lane runs `--permission-mode auto` without `--sandbox`, so Devin's approval policy, not an OS sandbox, rejects edits and writing shell commands, as Claude's `plan` mode does. With `--sandbox`, approved shell commands write in the cwd while the edit tools are rejected, so no Devin mode is a bounded writer. The runner refuses an `isolated-write` lane before launch.
- The lane passes `--respect-workspace-trust false`, so the runner refuses a Devin lane whose cwd, or any parent up to the git root, holds `.devin/`: Devin would load that repository's hooks, permissions and MCP servers.
- Each lane gets a run-owned `--config` file in its private `<receipt>.provider/` directory (0700). It turns off subagents, every host rule source (such as `CLAUDE.md`) and MCP tools, and denies web search and the fetch tools. Devin still loads its own skills. Network isolation is not established: shell network access and the fetch denials were not measured.
- The preflight passes when `devin auth status` exits 0 and starts with `Logged in (via Devin).`. It also exits 0 when logged out, so output starting with `Not logged in.` is `unauthenticated`/77, and any other output is `child-failed`/70.
- The reply, session, token usage and model proof come from the `--export` ATIF file at `<receipt>.provider/export.json`, never from stdout. The proof is the last step's `extra.generation_model`, which must equal the CLI model ID. An empty final message, as after a rejected tool call, is `child-failed`/70. An interrupted response, or exit 143 after SIGTERM, is `cancelled`/130. `Error: Unknown model:` is `unavailable-model`/69.

### opencode: OpenCode

- Executable: `opencode`.
- Host prerequisites: none.
- State paths: `~/.local/share/opencode/` (`auth.json`, the stored logins, which the CLI reads; the session database, logs and tool output it writes); `~/.local/state/opencode/`, `$XDG_CACHE_HOME/opencode/` and `$TMPDIR/opencode/`, which it writes.
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS`, and variables starting with `LC_`, `XDG_`; sets `XDG_CONFIG_HOME=<receipt>.provider`, `OPENCODE_CONFIG=<receipt>.provider/opencode.json`, `OPENCODE_DISABLE_PROJECT_CONFIG=1`, `OPENCODE_DISABLE_CLAUDE_CODE=1`, `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`, `OPENCODE_DISABLE_AUTOUPDATE=1`.
- The model is `provider/model`, such as `opencode/deepseek-v4.1-flash-free`. The effort is `--variant <effort>`, omitted for `default`. OpenCode accepts an unknown variant silently, so only a registered family's efforts are checked.
- Read-only only. Each lane uses the default `build` agent with a run-owned config whose `"*": "deny"` permission removes every tool except `read`, `glob`, `grep`, `list` and `todowrite` from the model's tool list. OpenCode's permission policy enforces this, not an OS sandbox. With `external_directory` denied, a shell write still escaped the cwd, so no OpenCode mode is a bounded writer, and the runner refuses an `isolated-write` lane before launch.
- The runner writes that config to `<receipt>.provider/opencode.json` (0600, in a 0700 directory), points `OPENCODE_CONFIG` at it and sets `XDG_CONFIG_HOME` to the directory, so the host's global OpenCode config, plugins and MCP servers do not load. `OPENCODE_DISABLE_PROJECT_CONFIG=1` stops the repository's `opencode.json`, `opencode.jsonc`, `.opencode/` agents and commands, and `AGENTS.md` from loading. `OPENCODE_DISABLE_CLAUDE_CODE=1` stops `~/.claude/CLAUDE.md` and `~/.claude/skills`, and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` stops `~/.agents/skills`. `OPENCODE_DISABLE_AUTOUPDATE=1` and `--pure` turn off updates and external plugins. The built-in `customize-opencode` skill remains, but the `skill` tool is denied.
- The runner refuses an OpenCode lane whose cwd, or any parent up to the git root, holds `.opencode/`. Even with `--pure` and `OPENCODE_DISABLE_PROJECT_CONFIG=1`, OpenCode 1.19.1 imports `.opencode/plugins/*.js`, which runs each module's top-level code; only the plugin's initialization is skipped.
- The child environment drops every other `OPENCODE_*` variable, because `OPENCODE_PERMISSION` turns `bash` and `edit` back on and others replace the config or the model catalog. It also drops provider keys such as `OPENROUTER_API_KEY`. A lane authenticates only through OpenCode's stored logins (`opencode auth login`, kept in `~/.local/share/opencode/auth.json`), or uses a free OpenCode Zen model, which needs no login.
- The preflight runs `opencode models <provider>`, where `<provider>` is the model's part before the first `/`. It passes when it exits 0 and one line equals the model. `Error: Provider not found:` with a nonzero exit is `unauthenticated`/77. Exit 0 without the model line is `unavailable-model`/69, and so is a model with no `/`. Any other output is `child-failed`/70.
- The lane passes `--title pstack-lane`, because without a title OpenCode calls a second model to name the session. The prompt goes on stdin.
- The reply, session ID, token usage and cost come from the `--format json` event stream on stdout. A lane is complete only when the last `step_finish` has reason `stop` and a `text` event follows the last `step_start`; the reply is those texts in order. Usage and cost are summed over every `step_finish`. An `error` event is `child-failed`/70. For an unknown model that event says only `UnknownError`, and `--print-logs --log-level ERROR` puts its `ProviderModelNotFoundError` cause on stderr, which the receipt keeps. A final `step_finish` with reason `tool-calls` is a permission prompt that headless OpenCode auto-rejected at exit 0, and is `child-failed`/70. Exit 130 or 143 after a signal is `cancelled`/130.
- No event names the served model, so the model proof is the pinned argv (`pinned-argv`).
- Sessions stay in the local session database. The config turns sharing off, and OpenCode 1.19.1 keeps no server-side session record.

### dsh: DeepSeek Harness

- Executable: `dsh`.
- Host prerequisites: dsh 0.2.0-rc.2 exactly.
- State paths: `~/.dsh/`: the stored key `~/.dsh/.credentials.yaml`, which the CLI reads, and the sessions (`sessions/<cwd-slug>/<session-id>/`), projection cache (`storages/session_projcache/`), `profiles/headless/` and `.anonymous-user-id` it writes on every run.
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS` `DEEPSEEK_API_KEY`, and variables starting with `LC_`, `XDG_`.
- Measured with dsh 0.2.0-rc.2, a developer preview. The runner checks `dsh --version` before the preflight and refuses any other version as `unavailable-cli`/69. Recheck on an upgrade: the config row IDs the patch names (dsh silently ignores a patch row it does not have, so a renamed row would drop that part of the lockdown), the SIGTERM exit 0 with a partial `final`, the hardcoded `/tmp` writable root, the session-log upload being on by default, the `.env` bootstrap-name refusal, and the transport retry row.
- Model and effort are config, not flags. Each lane gets a run-owned `--patch` file at `<receipt>.provider/patch.yml` (directory 0700, file 0600) that pins `agent-default-model` to provider `deepseek-official`, the lane's model and, unless the effort is `default`, its `reasoningEffort`. dsh offers efforts `off`, `low`, `high` and `max`, and fails `medium` locally.
- Read-only only. The patch pins `sandbox-policy` to `read-only` with the lane's cwd as the workspace root and `approval` to `ask`, which overrides `DSH_PERMISSION_MODE`. Seatbelt enforces it on macOS for bash and the file tools. Headless has no approval channel, so an escalation request fails closed. Bash keeps network access, and the `read` tool is not confined to the cwd. The runner refuses an `isolated-write` lane before launch.
- The patch turns off host and project rules (`AGENTS.md`, `CLAUDE.md` and their local variants), every skill root, the web, subagent and workflow tools, the session-title model call, the plugin inventory and the `dsh_session_log` upload. The goal, job, todo, plan-mode and `read_image` tools still load. dsh loads no project patch, hook or MCP file, so no project path is refused.
- dsh loads the cwd's `.env`. It refuses bootstrap names there (`DSH_*`, `DEEPSEEK_BASE_URL`, `PATH`, `NODE_OPTIONS`, `XDG_*`, `DYLD_*`, proxies) and exits 1, so the runner does not refuse a `.env`. Its other values reach the bash tool. A `DEEPSEEK_API_KEY` there authenticates when none is stored or exported.
- dsh has no status command. The preflight is a turn with the shipped `providers/dsh-preflight.yml` patch, which points inference at a closed loopback port and turns off retries, the title call and the session-log upload. `TRANSPORT` passes with the fixed evidence `credential present; not validated`: it proves only that a key is stored or exported, not that the key works. `MISSING_CREDENTIAL` is `unauthenticated`/77, and any other output is `child-failed`/70.
- The reply is the `--json` stream's `final` text, accepted only after a `status` `turn_end` with `reason.kind` `completed`. SIGTERM exits 0 with a partial `final` and no `turn_end`, so that is `malformed-output`/65, never complete. Exit 130 after SIGINT is `cancelled`/130. A `turn_end` error is `child-failed`/70 with its code and message, except that DeepSeek's `The supported API model names are ...` refusal is `unavailable-model`/69. Usage sums the `step_end` usage; the session ID is the `session` event's. No cost is reported.
- No served model is reported, so the model proof is the pinned patch (`pinned-argv`).
- Server side: requests still carry the `x-deepseek-harness-user-id` and `x-deepseek-harness-session-id` headers. Whether DeepSeek keeps request content is not measured.

### amp: Amp CLI

- Executable: `amp`.
- Host prerequisites: none.
- State paths: `~/.local/share/amp/` (the login in `secrets.json`, accounts, session and recent threads) and `~/.cache/amp/` (logs, downloaded plugins and skills).
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS` `AMP_API_KEY`, and variables starting with `LC_`, `XDG_`; sets `AMP_IGNORE_GUIDANCE_FILES=*`.
- Effort is part of the model ID. The model is an official Amp agent mode, such as `deepseek-v4.1-flash`, from Amp's own `official-modes` plugin, which Amp serves to every user. Where a mode has effort variants, the variant is part of its name (for example `gpt-6-astra-low` to `gpt-6-astra-max`). An unregistered Amp model must be a mode name with the `default` effort. An unknown mode exits 1 with a generic error and ends `child-failed`/70.
- Read-only only. Amp has no OS sandbox and auto-approves its `ask` rules in execute mode, and a shell write escaped the cwd whenever the shell was allowed, so no Amp mode is a bounded writer. The runner refuses an `isolated-write` lane before launch.
- Each lane gets a run-owned `--settings-file` in its private `<receipt>.provider/` directory (0700). It enables only the `Read` tool and rejects every other tool, which turns off the shell, edits, subagents, web tools, code execution, thread tools and `manage_amp`. It also turns off MCP servers, Claude Code and `~/.agents` skills, updates and notifications. The lane sets `AMP_IGNORE_GUIDANCE_FILES=*`, so `AGENTS.md` in the cwd and its parents does not load. The `official-modes` workspace plugin still loads, because it supplies the modes. `Read` can read any path on the host.
- The runner refuses an Amp lane whose cwd, or any parent up to the git root, holds `.amp`: a `.amp/settings.json` there overrides the run-owned settings, and `.amp/plugins/*.ts` runs its code at startup with no trust check.
- The environment is an allowlist that adds only `AMP_API_KEY`. No other `AMP_` name passes: `AMP_SETTINGS_FILE`, `AMP_EXECUTOR`, `AMP_INITIAL_AGENT_MODE_KEY` and `AMP_URL` would change the settings, where the turn runs, the mode or the service.
- The preflight is `amp usage`, run without a terminal. It passes when it exits 0 and starts with `Signed in as `, and records the fixed evidence `authenticated`, because the output holds the account email and credit balance. Exit 1 with `Invalid or missing API key` is `unauthenticated`/77, and any other output is `child-failed`/70. A logged-out Amp command other than `amp usage` can open a browser login on its own, which is why the runner never starts a turn without a passing preflight.
- The reply, session and token usage come from the stream JSON on stdout: the reply is the `result` event's text, the session is its `session_id` (`T-<uuid>`, also the ampcode.com thread ID), and the usage sums each assistant message's `usage`. The stream has no cost and never names the model, so the proof is the pinned mode in the argv (`pinned-argv`).
- Failures and cancellations can exit 0, so the `result` event decides. `is_error: true` with `User cancelled (SIGINT/SIGTERM)` is `cancelled`/130, and any other `is_error` result is `child-failed`/70 with its error text, for example a Claude mode on a subscription-only account. A rejected tool comes back to the model as an ordinary tool result, and the turn can still complete.
- Each run is an ampcode.com thread holding the prompt, tool inputs and outputs, the hostname and the working directory. The lane passes `--visibility private` and the label `pstack-runner`; every captured thread was private and archived. Turns spend Amp credits, or a linked ChatGPT subscription for GPT modes.

### agy: Antigravity CLI (`agy`)

- Executable: `agy`.
- Host prerequisites: none.
- State paths: `~/.gemini/antigravity-cli/`, where the CLI writes conversations, `brain/`, logs, caches and `conversation_summaries.db`; the login is in the macOS keychain.
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS`, and variables starting with `LC_`, `XDG_`.
- Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort and never passes `--effort`, because a variant ID with a conflicting `--effort` exits 1. A bare `gemini-3.8-flash` runs as `gemini-3.8-flash-high`. Issue #37 asked for Gemini 3.7 Flash, but `agy models` did not list it for the measured account. The runner registers Gemini 3.8 Flash and never maps a 3.7 request to it.
- Read-only only. A lane runs agy's default mode, whose approval policy, not an OS sandbox, denies the write tool and every shell command. `--mode accept-edits` writes only through the edit tool and denies shell, and `--sandbox` blocks shell writes even in the cwd, so no agy mode is a bounded writer. The runner refuses an `isolated-write` lane before launch.
- Headless agy cannot ask for approval. The first tool that needs it is denied, and the turn ends with exit 0, `status: "SUCCESS"`, an empty `response` and a `denied_actions` list. The runner records that as `child-failed`/70.
- Each lane writes a run-owned agent file, `.agents/agents/pstack-read-only.md`, in its private `<receipt>.provider/` directory (0700, the file 0600), and runs `--add-dir <that directory> --agent pstack-read-only`. The agent declares only `view_file`, no MCP servers and no skills. The lane keeps `view_file` and `manage_task` and loses web search, `read_url_content`, subagents, `schedule`, `send_message` and the browser. If the file is missing, agy exits 1 with `unknown agent`.
- The runner refuses an agy lane whose cwd, or any parent up to the git root, holds `.agents`, `.agent`, `_agents` or `_agent`. agy runs the hooks and MCP servers there with no trust check and loads their rules and skills, and a repository agent named `pstack-read-only` would replace the run-owned one.
- No flag turns off the operator's own configuration. `~/.gemini/GEMINI.md` loads as a global rule, and host skills and agy plugin hooks under `~/.gemini/` still load in every lane. The run-owned agent limits only the lane's tools.
- The lane passes the base allowlist and nothing else. The login is in the macOS keychain, found through `HOME`, so a run-owned `HOME` would be logged out. `GEMINI_API_KEY` did not authenticate and is not passed.
- The preflight runs `agy models` and passes when it exits 0 and a line's first tab-separated field is the lane's CLI model ID. Exit 0 without that line is `unavailable-model`/69. Exit 1 with `Please sign in` is `unauthenticated`/77. Any other output is `child-failed`/70.
- The prompt goes to stdin as one stream-json line, `{"event":"user","message":{"role":"user","content":<prompt>}}`, with `--input-format stream-json --output-format stream-json`. The reply is the `result` event's `response` without its trailing newline. The session is `conversation_id`, and usage is `usage`, with `thinking_tokens` as reasoning and `cache_read_tokens` as cached input. agy reports no cost.
- agy never reports the served model. `init.model` repeats `--model`, and only an internal log names the resolved model, so the proof is the pinned argv. An unknown model exits 1 with `invalid model selection`, which is `unavailable-model`/69. A `result` error of `interrupted`, after SIGINT or SIGTERM, is `cancelled`/130.

### cursor: Cursor CLI (`cursor-agent`)

- Executable: `cursor-agent`.
- Host prerequisites: none.
- State paths: `~/.cursor/`, where the CLI reads `mcp.json`, `hooks.json`, plugins and skills and writes `chats/`, `projects/<slug>/`, `statsig-cache.json` and `agent-cli-state.json`; the stored login is in the macOS keychain; `<receipt>.provider/`, the run-owned `CURSOR_CONFIG_DIR`, where the CLI writes `chats/` and `statsig-cache.json` and rewrites `cli-config.json` at 0644 with an identity block, keeping the run-owned permissions; `~/Library/Caches/cursor-compile-cache/`, `$TMPDIR/cursor-agent-logs-<uid>/` and `~/.npm/_npx/`, which it writes.
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS` `CURSOR_API_KEY` `CURSOR_AUTH_TOKEN`, and variables starting with `LC_`, `XDG_`; sets `CURSOR_CONFIG_DIR=<receipt>.provider`.
- The executable is `cursor-agent`. Cursor also installs `agent`, and on a host where another CLI's `agent` comes first on PATH (Grok's, for example), `agent status --format json` exits 2 with empty stdout, which looked like an empty Cursor status in #94.
- Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort, such as `gemini-3.7-flash-high`. An unregistered Cursor model must be a CLI model ID with the `default` effort. An unknown model exits 1 with `Cannot use this model: <id>`, which is `unavailable-model`/69.
- Read-only only. A lane runs `-p --output-format stream-json --mode ask --sandbox enabled --trust` with the prompt on stdin. Only `--mode ask --sandbox enabled` refused every edit and shell request, including `ls`; the CLI's permission check enforces it, and the Read tool still works. In agent mode the edit tool wrote outside the cwd under every flag combination, so no Cursor mode is a bounded writer. The runner refuses an `isolated-write` lane before launch. `--trust` is required in a new directory. The lane never passes `--force`, `--yolo` or `--approve-mcps`.
- Each lane sets `CURSOR_CONFIG_DIR` to its private `<receipt>.provider/` directory (0700) and writes `cli-config.json` there (0600) before the preflight. The config denies `Write(**)`, `Shell(*)` and `Mcp(*:*)`, sets `approvalMode: "allowlist"` with no allow rules, enables the sandbox, and turns off web-search auto-approval and the web-fetch domain allowlist. MCP and plugin tools (such as the GitHub, Gmail and Calendar plugins) are still listed to the model, but every call is blocked. Web search and web fetch are refused, because nothing approves them. A Task subagent runs with the same limits. Without the run-owned directory, every `-p` run rewrites `~/.cursor/cli-config.json` with its default model and an identity block.
- The runner refuses a Cursor lane whose cwd, or any parent up to the git root, holds `.cursor/`, `.claude/settings.json` or `.claude/settings.local.json`. A project `.cursor/cli.json` replaces the run-owned deny list (a measured run then called the GitHub plugin's `get_me`), `.cursor/hooks.json` hooks run, and the hooks in both `.claude/` settings files run. No flag stops any of them.
- No flag turns off the operator's own configuration. Hooks in `~/.cursor/hooks.json` and `~/.claude/settings.json` run inside every turn, and host skills (from `~/.cursor`, `~/.claude`, `~/.codex` and `~/.agents`), account plugins and `~/.cursor/mcp.json` still load. The run-owned deny list limits only what their tools can do. A repository's `AGENTS.md`, `CLAUDE.md`, `.cursorrules` and rules load as always-applied rules.
- The environment is an allowlist that adds only `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`, the two logins the CLI's own error names, and sets `CURSOR_CONFIG_DIR`. No other `CURSOR_` name passes: `CURSOR_API_ENDPOINT`, `CURSOR_API_BASE_URL`, `CURSOR_SANDBOX_POLICY_DIR`, `CURSOR_FORCED_SHELL_EGRESS` and the rest change the service, the sandbox or the egress. On the measured macOS host, a `cursor-agent login` run while `CURSOR_API_KEY` was set left a stored login that `status` reported as authenticated but that failed every model call once the variable was gone; signing out and in again with `env -u CURSOR_API_KEY cursor-agent login` fixed it.
- The preflight runs `cursor-agent models`, not `status`: `status` reports a stored login as authenticated while every model call fails with `Authentication required`, and it ignores `CURSOR_API_KEY`. The preflight passes when `models` exits 0, its stdout starts with `Available models`, and a line starts with `<CLI model ID> - `, and records the fixed evidence `model <id> listed`. Exit 0 without that line is `unavailable-model`/69. Exit 1 with `Error: Authentication required` is `unauthenticated`/77. Any other output, including empty output, is `child-failed`/70.
- The `result` event decides. A `success` result with `is_error: false` is complete, and the reply is the last `assistant` event's text, because the `result` field joins every assistant text segment of the turn. `is_error: true` is `child-failed`/70 with its text. A refused tool comes back to the model as a tool result, and the turn can still complete. SIGINT exits 130 and SIGTERM 143 with no `result` event. The session is `session_id`, and usage is `result.usage`, with `cacheReadTokens` as cached input and `cacheWriteTokens` as cache creation. Cursor reports no cost.
- Cursor never reports the served model ID. The init event's `model` is a display label such as `Claude Opus 5.5 300K High`, so the proof is the pinned argv (`pinned-argv`).
- Each turn leaves a detached `worker-server` and `typescript-language-server` pair in the CLI's process group. They exit after about five idle minutes.

## Role defaults

The complete first-run sheet. A sheet that lacks a role uses that role's line here.

```markdown
# pstack model configuration

Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. Every documented role remains present. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.

feature, refactoring: grok:grok-4.7@xhigh
bug-fix: codex:gpt-6.1-sol@max
perf-issue: codex:gpt-6.1-sol@max
hillclimb: codex:gpt-6.1-sol@max
judgment and prose: claude:opus@max
hardest tasks: claude:opus@max
how explorer: grok:grok-4.7@xhigh
how explainer: claude:opus@max
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: claude:opus@max, codex:gpt-6.1-sol@max, grok:grok-4.7@xhigh
arena cross-judge pool: claude:opus@max, codex:gpt-6.1-sol@max, grok:grok-4.7@xhigh
swarm workers: grok:grok-4.7@xhigh
architect runners: claude:opus@max, codex:gpt-6.1-sol@max, grok:grok-4.7@xhigh
interrogate reviewers: claude:opus@max, codex:gpt-6.1-sol@max, grok:grok-4.7@xhigh
```
