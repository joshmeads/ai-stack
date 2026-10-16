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
| deepseek-flash | DeepSeek Flash (dsh) | dsh | deepseek-flash | max | low high max | - | optional | - |
| deepseek-v4-pro | DeepSeek V4 Pro (dsh) | dsh | deepseek-v4-pro | max | low high max | - | optional | - |
| gemini-3.8-flash | Gemini 3.8 Flash (Antigravity) | agy | gemini-3.8-flash | high | low medium high | - | optional | - |

A family is `default` when a role default names it and `optional` otherwise. A Claude-native agent exists for each selectable effort of a Claude family.

Effort in the model ID: for these families the effort selects the CLI model, and argv carries no effort flag.

| Family | Effort | CLI model |
| --- | --- | --- |
| swe-2 | medium | `swe-2-medium` |
| swe-2 | high | `swe-2-high` |
| swe-2 | max | `swe-2-max` |
| swe-1.6 | default | `swe-1-6` |
| gemini-3.8-flash | low | `gemini-3.8-flash-low` |
| gemini-3.8-flash | medium | `gemini-3.8-flash-medium` |
| gemini-3.8-flash | high | `gemini-3.8-flash-high` |

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
| dsh | external runner | external runner | `read-only` | stdin | pinned argv | allowlist | dsh 0.2.0-rc.2 exactly |
| agy | external runner | external runner | `read-only` | stdin | pinned argv | allowlist | - |

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
- The lane passes `--respect-workspace-trust false`, so the runner refuses a Devin lane whose cwd, or any parent up to the git root (or `/` outside a repository), holds `.devin/`: Devin would load that repository's hooks, permissions and MCP servers. Under the home directory, the lane runs only inside a git repository rooted below it, because the CLI's own walk would otherwise reach the home directory's config.
- Each lane gets a run-owned `--config` file in its private `<receipt>.provider/` directory (0700). It turns off subagents, every host rule source (such as `CLAUDE.md`) and MCP tools, and denies web search and the fetch tools. Devin still loads its own skills. Network isolation is not established: shell network access and the fetch denials were not measured.
- The preflight passes when `devin auth status` exits 0 and starts with `Logged in (via Devin).`. It also exits 0 when logged out, so output starting with `Not logged in.` is `unauthenticated`/77, and any other output is `child-failed`/70.
- The reply, session, token usage and model proof come from the `--export` ATIF file at `<receipt>.provider/export.json`, never from stdout. The proof is the last step's `extra.generation_model`, which must equal the CLI model ID. An empty final message, as after a rejected tool call, is `child-failed`/70. An interrupted response, or exit 143 after SIGTERM, is `cancelled`/130. `Error: Unknown model:` is `unavailable-model`/69.

### dsh: DeepSeek Harness

- Executable: `dsh`.
- Host prerequisites: dsh 0.2.0-rc.2 exactly.
- State paths: `<receipt>.provider/`, the lane's own `DSH_HOME`: the sessions (`sessions/<cwd-slug>/<session-id>/`), projection cache (`storages/session_projcache/`), `profiles/headless/` and `.anonymous-user-id` that dsh writes on every run; The stored key `<DSH_HOME, else ~/.dsh>/.credentials.yaml`, which the lane reads in place and does not copy.
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS` `DEEPSEEK_API_KEY`, and variables starting with `LC_`, `XDG_`; sets `DSH_HOME=<receipt>.provider`.
- Measured with dsh 0.2.0-rc.2, a developer preview. The runner checks `dsh --version` before the preflight and refuses any other version as `unavailable-cli`/69. Recheck on an upgrade: the config row IDs the patch names (dsh silently ignores a patch row it does not have, so a renamed row would drop that part of the lockdown), the SIGTERM exit 0 with a partial `final`, the hardcoded `/tmp` writable root, the session-log upload being on by default, that dsh reads only the cwd's `.env` and skips a directory there, the transport retry row, and the `credentials` row's `path` config.
- Model and effort are config, not flags. Each lane gets a run-owned `--patch` file at `<receipt>.provider/patch.yml` (directory 0700, file 0600) that pins `agent-default-model` to provider `deepseek-official`, the lane's model and, unless the effort is `default`, its `reasoningEffort`. dsh offers efforts `off`, `low`, `high` and `max`, and fails `medium` locally.
- Each lane runs with `DSH_HOME` set to its `<receipt>.provider/` directory, and the allowlist drops every inherited `DSH_*` name. dsh creates the `headless` profile there on first use with no network or `pnpm` install (about 70 ms), so no user layer (`profiles/headless/cordis.patch.yml`) and no home `.env` from the operator's dsh home loads. Measured with `--dump-config`: a planted user layer that redirected `llm-deepseek.config.baseURL`, moved `fs-sandbox.config.cwd`, picked another `agent-default-model` provider and disabled `bash-sandbox` changed nothing, and the composed tree was the default rows plus the lane's patch. The patch's `credentials` row points the credential store at `<the parent's DSH_HOME, else ~/.dsh>/.credentials.yaml`, read in place. A key kept only in the operator's `<DSH_HOME>/.env` no longer authenticates; store it or export `DEEPSEEK_API_KEY`.
- Read-only only. The patch pins `sandbox-policy` to `read-only` with the lane's cwd as the workspace root and `approval` to `ask`, which overrides `DSH_PERMISSION_MODE`. The other sandbox rows keep dsh's defaults, including the bash tool's own timeout; the runner adds no deadline. Seatbelt enforces it on macOS for bash and the file tools. Headless has no approval channel, so an escalation request fails closed. Bash keeps network access, and the `read` tool is not confined to the cwd. The runner refuses an `isolated-write` lane before launch.
- The patch turns off host and project rules (`AGENTS.md`, `CLAUDE.md` and their local variants), every skill root, the web, subagent and workflow tools, the session-title model call, the plugin inventory and the `dsh_session_log` upload. The goal, job, todo, plan-mode and `read_image` tools still load. dsh loads no project patch, hook or MCP file.
- The runner refuses a dsh lane whose cwd holds a `.env` file, before the preflight. dsh loads that file at boot, before any config row applies, and no setting turns it off. dsh rejects only bootstrap names there (`DSH_*`, `DEEPSEEK_BASE_URL`, `PATH`, `NODE_OPTIONS`, `XDG_*`, `DYLD_*`, proxies), and every other value reaches the bash tool: a repository `.env` that sets `GIT_CONFIG_PARAMETERS` with `core.fsmonitor` makes a plain `git status` run the repository's script. dsh reads only the cwd's `.env`, not a parent's, and warns and skips a directory named `.env`, such as a Python virtual environment, so neither is refused. A key stored in `<DSH_HOME, else ~/.dsh>/.credentials.yaml` or an exported `DEEPSEEK_API_KEY` still authenticates. Under the home directory, the lane runs only inside a git repository rooted below it, so a cwd that is the home directory cannot load `~/.env`.
- dsh has no status command. The preflight is a turn on the lane's `DSH_HOME` with the lane's patch and then the shipped `providers/dsh-preflight.yml` patch, which points inference at a closed loopback port and turns off retries. The lane's patch already turns off the title call and the session-log upload. `TRANSPORT` passes with the fixed evidence `credential present; not validated`: it proves only that a key is stored or exported, not that the key works. `MISSING_CREDENTIAL` is `unauthenticated`/77, and any other output is `child-failed`/70.
- The reply is the `--json` stream's `final` text, accepted only after a `status` `turn_end` with `reason.kind` `completed`. SIGTERM exits 0 with a partial `final` and no `turn_end`, so that is `malformed-output`/65, never complete. Exit 130 after SIGINT is `cancelled`/130. A `turn_end` error is `child-failed`/70 with its code and message, except that DeepSeek's `The supported API model names are ...` refusal is `unavailable-model`/69. Usage sums the `step_end` usage; the session ID is the `session` event's. No cost is reported.
- No served model is reported, so the model proof is the pinned patch (`pinned-argv`).
- Server side: requests still carry the `x-deepseek-harness-user-id` and `x-deepseek-harness-session-id` headers. Whether DeepSeek keeps request content is not measured.

### agy: Antigravity CLI (`agy`)

- Executable: `agy`.
- Host prerequisites: none.
- State paths: `~/.gemini/antigravity-cli/`, where the CLI writes conversations, `brain/`, logs, caches and `conversation_summaries.db`; the login is in the macOS keychain.
- Child environment: only `PATH` `HOME` `USER` `LOGNAME` `SHELL` `TMPDIR` `LANG` `TERM` `COLORTERM` `TZ` `HTTP_PROXY` `HTTPS_PROXY` `NO_PROXY` `ALL_PROXY` `http_proxy` `https_proxy` `no_proxy` `all_proxy` `SSL_CERT_FILE` `SSL_CERT_DIR` `NODE_EXTRA_CA_CERTS`, and variables starting with `LC_`, `XDG_`.
- Effort is part of the model ID. The runner passes the CLI model ID that the effort table gives for the requested effort and never passes `--effort`, because a variant ID with a conflicting `--effort` exits 1. A bare `gemini-3.8-flash` runs as `gemini-3.8-flash-high`. Issue #37 asked for Gemini 3.7 Flash, but `agy models` did not list it for the measured account. The runner registers Gemini 3.8 Flash and never maps a 3.7 request to it.
- Read-only only. A lane runs agy's default mode, whose approval policy, not an OS sandbox, denies the write tool and every shell command. `--mode accept-edits` writes only through the edit tool and denies shell, and `--sandbox` blocks shell writes even in the cwd, so no agy mode is a bounded writer. The runner refuses an `isolated-write` lane before launch.
- Headless agy cannot ask for approval. The first tool that needs it is denied, and the turn ends with exit 0, `status: "SUCCESS"` and a `denied_actions` list. Any `response` text is a preamble written before the denied tool, so the runner records a non-empty `denied_actions` as `child-failed`/70 whatever the response says.
- Each lane writes a run-owned agent file, `.agents/agents/pstack-read-only.md`, in its private `<receipt>.provider/` directory (0700, the file 0600), and runs `--add-dir <that directory> --agent pstack-read-only`. The agent declares only `view_file`, no MCP servers and no skills. The lane keeps `view_file` and `manage_task` and loses web search, `read_url_content`, subagents, `schedule`, `send_message` and the browser. If the file is missing, agy exits 1 with `unknown agent`.
- The runner refuses an agy lane whose cwd, or any parent up to the git root (or `/` outside a repository), holds a `.agents/`, `.agent/`, `_agents/` or `_agent/` directory. agy runs the hooks and MCP servers there with no trust check and loads their rules and skills, and a repository agent named `pstack-read-only` would replace the run-owned one. Under the home directory, the lane runs only inside a git repository rooted below it, because the CLI's own walk would otherwise reach the home directory's config.
- No flag turns off the operator's own configuration. `~/.gemini/GEMINI.md` loads as a global rule, and host skills and agy plugin hooks under `~/.gemini/` still load in every lane. The run-owned agent limits only the lane's tools.
- The lane passes the base allowlist and nothing else. The login is in the macOS keychain, found through `HOME`, so a run-owned `HOME` would be logged out. `GEMINI_API_KEY` did not authenticate and is not passed.
- The preflight runs `agy models` and passes when it exits 0 and a line's first tab-separated field is the lane's CLI model ID. Exit 0 without that line is `unavailable-model`/69. Exit 1 with `Please sign in` is `unauthenticated`/77. Any other output is `child-failed`/70.
- The prompt goes to stdin as one stream-json line, `{"event":"user","message":{"role":"user","content":<prompt>}}`, with `--input-format stream-json --output-format stream-json`. The reply is the `result` event's `response` without its trailing newline. The session is `conversation_id`, and usage is `usage`, with `thinking_tokens` as reasoning and `cache_read_tokens` as cached input. agy reports no cost.
- agy never reports the served model. `init.model` repeats `--model`, and only an internal log names the resolved model, so the proof is the pinned argv. An unknown model exits 1 with `invalid model selection`, which is `unavailable-model`/69. A `result` error of `interrupted`, after SIGINT or SIGTERM, is `cancelled`/130.

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
