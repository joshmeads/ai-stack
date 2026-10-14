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

A family is `default` when a role default names it and `optional` otherwise. A Claude-native agent exists for each selectable effort of a Claude family.

Effort in the model ID: for these families the effort selects the CLI model, and argv carries no effort flag.

| Family | Effort | CLI model |
| --- | --- | --- |
| swe-2 | medium | `swe-2-medium` |
| swe-2 | high | `swe-2-high` |
| swe-2 | max | `swe-2-max` |
| swe-1.6 | default | `swe-1-6` |

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
