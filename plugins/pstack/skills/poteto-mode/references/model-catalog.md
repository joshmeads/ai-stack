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

A family is `default` when a role default names it and `optional` otherwise. A Claude-native agent exists for each selectable effort of a Claude family.

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

| Provider | Claude Code parent | Codex parent | Prompt | Model proof | Child environment | Host prerequisites |
| --- | --- | --- | --- | --- | --- | --- |
| claude | native `Agent` | external runner | stdin | provider report | read-only: inherited; isolated-write: inherited without `GIT_*` | - |
| codex | external runner | native `spawn_agent` | stdin | pinned argv | inherited | - |
| grok | external runner | external runner | file | provider report | allowlist | Linux: Landlock and `bwrap` |

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
