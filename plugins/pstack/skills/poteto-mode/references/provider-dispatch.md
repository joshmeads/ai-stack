# Provider dispatch

jm:stack model choices are provider-qualified descriptors:

```text
<provider>:<model>@<effort>
```

## Model matrix

| Family | Upstream pstack choice | Provider | Model | Default effort | Selectable efforts | Claude-native agent stem |
|---|---|---|---|---|---|---|
| fable | - | claude | fable | max | low medium high xhigh max | fable |
| sol | gpt-5.6-sol-max | codex | gpt-6.1-sol | xhigh | low medium high xhigh max ultra | - |
| luna | - | codex | gpt-6-luna | xhigh | low medium high xhigh max | - |
| opus | opus | claude | opus | xhigh | low medium high xhigh max | opus |
| haiku | - | claude | haiku | xhigh | low medium high xhigh max | haiku |

The allowed effort universe is exactly `low`, `medium`, `high`, `xhigh`, `max`, `ultra`. A row offers `ultra` only when its CLI's model entry lists that effort; for Codex, that is the model's entry in `codex`'s model list. `gpt-6.1-sol` lists it. `gpt-6-luna` and the Claude rows do not. First-run requested efforts are the Default effort cell of each row. The first-run panel is Opus and Sol, in that order, and every other first-run role uses Opus or Sol. Fable, Luna, and Haiku stay selectable, but no first-run role uses them. A Claude-native agent stem of `-` means the family has no Claude-native agent. Otherwise the shipped agent name is `stack-<stem>-<effort>`.

`fable`, `opus`, and `haiku` are Claude Code's rolling aliases. Claude resolves each alias to the latest available family revision. A runner receipt keeps the requested alias in `model` and the concrete provider-reported revision in `reportedModel`; verification accepts only a numeric `claude-fable-*`, `claude-opus-*`, or `claude-haiku-*` revision from the matching family.

## Descriptor spelling

A sheet that another tool writes, such as the ai-stack CLI's per-harness sheet, follows the same grammar and uses the Model cell of a matrix row unchanged. A Claude descriptor names the rolling alias: `claude:opus@medium`, `claude:haiku@xhigh`. Never write a concrete Claude revision such as `claude-opus-5-5` or `claude-haiku-5-5`; read-time normalization would rewrite it in memory and report the sheet stale on every run, and the runner rejects it. A Codex descriptor names the concrete model: `codex:gpt-6.1-sol@xhigh`, `codex:gpt-6-luna@xhigh`. The effort must appear in that row's Selectable efforts cell. Write every documented role line in the first-run sheet's order, and keep the Why and Reflect roles on `inherit-parent` or `auto`.

## Read-time normalization

Normalize configured descriptors before matching them to the matrix or choosing a route. If a provider-qualified Claude model starts with `claude-fable-`, `claude-opus-`, or `claude-haiku-` and its remaining revision contains only digits and hyphens, replace that model component in memory with `fable`, `opus`, or `haiku`. Preserve provider, effort, role, and lane order. Use only the normalized descriptor for native dispatch or runner argv. Never pass the versioned predecessor to Claude.

This read-time rule makes an older installed sheet use the latest family revision immediately without writing user files. Once per parent run, report that the persisted sheet is stale and that `/setup-stack` will rewrite it after its normal probes and confirmation. Unknown versioned Claude models remain invalid. The external runner rejects a missed Fable, Opus, or Haiku version pin instead of silently executing it.

`codex:gpt-5.6-sol@<effort>` is the previous Sol default. Match it to the Sol row and dispatch it unchanged, with the sheet's model and effort, until `/setup-stack` replaces it. Do not rewrite it in memory.

## The parent owns the route

The top-level harness resolves the route once. A child receives an assigned provider, model, effort, access mode, prompt, working directory, and output path. A child never detects the harness, chooses a provider, or launches another model. Environment markers may corroborate the top-level harness before fan-out, but nested processes inherit parent markers and must not use them for routing.

| Parent | `claude:*` | `codex:*` |
|---|---|---|
| Claude Code | native `Agent` | external runner |
| Codex | external runner | native `spawn_agent` |

`inherit-parent` and `auto` remain aliases. They use the parent's current model and effort through its native subagent primitive. In a panel they still consume one lane, but they reduce provider diversity; say so in the synthesis record.

## Native lanes

Native dispatch avoids a second CLI startup and its base context.

- Claude Code: match the descriptor's `(provider, model)` to one model-matrix row, then dispatch it through `stack-<stem>-<effort>` using that row's Claude-native agent stem and the descriptor's effort. Those definitions select the rolling model alias, requested effort, and `background: true`. `stack-opus-xhigh` and `stack-haiku-xhigh` are in that set. Pass the complete task, grounding paths, access mode, and unique output location in the `Agent` prompt. Retain the task handle and drain it only after fan-out.
- Codex: call `spawn_agent` with the descriptor's model and `reasoning_effort`, the complete task, grounding paths, access mode, and unique output location. Use an isolated worktree for a writer. Codex subagents already run concurrently.

Do not send a same-provider descriptor to the external runner. It rejects that call because the native route is cheaper and already available.

## External lanes

The launcher lives at `skills/poteto-mode/scripts/runner/pstack-runner` under the installed plugin. The parent writes the complete candidate prompt to a unique file, creates a unique output directory or worktree, and invokes the launcher directly. Do not put another agent in front of it.

```text
pstack-runner \
  --parent <claude|codex> \
  --provider <claude|codex> \
  --model <real CLI model> \
  --effort <low|medium|high|xhigh|max|ultra> \
  --mode <read-only|isolated-write> \
  --prompt <unique prompt file> \
  --cwd <repository or dedicated worktree> \
  --output <unique final-response file> \
  --receipt <unique receipt file> \
  [--timeout <seconds>]
```

Pass arguments as an argv array or quote every path. Never interpolate prompt text into a shell command. The launcher preflights the assigned CLI and authentication, invokes the model exactly once, disables recursive agents and ambient skill dispatch where the CLI supports it, restricts the built-in tool surface, and records the exact provider/model/effort flags. Claude and Codex lanes inherit the parent environment without the other harness's identity markers, and a Claude writer also loses `GIT_*`. External lanes do not receive the parent's MCP surface. Keep MCP-dependent Why and Reflect roles on `inherit-parent` or `auto`. The launcher never falls back.

The authentication preflight runs once, and model execution is never retried.

### Host and parent prerequisites

- The parent tool sandbox still governs whether a subscribed child CLI can reach its credentials and network. Run setup's live probe from the actual parent profile. A blocked external CLI is a loud dropout, not a reason to elevate permissions or substitute a model silently.
- Codex's default `workspace-write` parent with network disabled can block external Claude lanes: network lookups can fail (for example, `ENOTFOUND`), and required outside-workspace state writes can be denied. In operator checks with Codex CLI 0.160.0 on macOS, the restricted session exposed `CODEX_SANDBOX=seatbelt` and `CODEX_SANDBOX_NETWORK_DISABLED=1`; full access exposed neither. Missing markers do not prove full access. Read the parent's effective permission instructions for network and the actual required paths; `workspace-write` alone does not establish either permission, and writable roots can include `CODEX_HOME`.
- `/setup-stack` checks assigned external lanes' required access before any external CLI check or probe. If access is blocked or unresolved, the operator can restart with suitable permissions or explicitly choose native-only role assignments. Setup separately checks both actual configuration destinations before any write, leaving existing bytes unchanged on refusal. It does not alter Codex permissions, silently replace families, or lower effort.
- A dispatched runner still launches the instructed lane. Only after a plain `child-failed` without a provider-reported reason, an explicit Codex parent with `CODEX_SANDBOX_NETWORK_DISABLED=1` gets a likely-parent-sandbox hint in the existing error message and the front of its bounded evidence. The status remains `child-failed`/70; raw child evidence is retained. Provider-reported reasons, other failure statuses, successful runs, and Claude parents are unchanged. This post-failure hint is not a permission check or proof that every DNS or write error came from a sandbox.

The parent invocation must itself be resumable background work:

- Claude Code: call the launcher through a Bash tool invocation with `run_in_background: true` and retain its task ID. A foreground Bash tool call has an automatic ten-minute ceiling even when the runner's own timeout is longer. Shelling out with `&` and losing the task handle is not equivalent.
- Codex: run the launcher in a persistent exec session that returns a session ID, then wait or poll that handle. Do not hold one foreground tool call open for the model's full runtime.

Start the background process, continue launching the other lanes, then drain their handles. Native and external lanes belong in the same fan-out phase.

The runner and its preflight have no implicit timeout. Do not invent a duration from role, mode, or a convenient round number; real implementation lanes can run for 90 minutes or much longer. Pass `--timeout` only when the user, an external service deadline, or a measured task contract supplies a real bound. That value starts at wrapper entry, before module loading and argument parsing, and remains one absolute deadline across setup, preflight, model execution, and output capture. It is never a fresh allowance per child, and long waits are armed in runtime-safe chunks without shortening the supplied deadline. Otherwise supervise liveness through the retained background task/session handle and cancel manually only on evidence that the run is dead. Cancel through that retained handle so the runner receives SIGINT or SIGTERM, sends it to an active child when one remains, stops waiting on inherited output pipes, removes the empty output reservation, and writes a `cancelled` receipt. Preserve that receipt; a retry is a new attempt with new unique output and receipt paths. Unchanged running state is not a dropout, and Claude's ten-minute foreground ceiling is never a reason to terminate a healthy lane.

Read-only mode maps to Claude plan mode with project-only settings and an explicit tool list, and Codex's read-only sandbox. `isolated-write` maps to Claude `acceptEdits` with project-only settings plus the Claude Code Bash sandbox, and Codex `workspace-write`. The Claude writer's Bash runs without prompts in that sandbox, and in a linked worktree the runner denies writes to the main repository's shared `.git`. The runner refuses the writer before launch when it cannot resolve that shared `.git` exactly or express its path literally. Give every writer only a dedicated worktree or output directory. Never route a writer into the primary checkout.

Every concurrent external lane needs distinct prompt, output, and receipt paths. The launcher exclusively reserves the output, receipt, and `<receipt>.stdout` / `<receipt>.stderr` sidecars with private (`0600`) permissions and refuses to overwrite existing files. All these paths must be distinct from each other and the prompt; a failed reservation rolls back only files created by that attempt. Schema-version-1 receipts add nullable `stdoutPath` and `stderrPath` fields identifying reserved artifacts. Sidecars retain the model process's raw stdout/stderr bytes, including on dropouts; they do not include authentication-preflight output. Cancellation and timeout retain every byte captured before the drain stops. Keep these private local files with the receipt; quote only operator-selected excerpts in public evidence.

## Completion and dropouts

Success requires all of these:

1. Exit status `0`.
2. Receipt status `complete`.
3. Either `modelVerified: true` with `modelEvidence: "provider-report"`, or a Codex receipt with `reportedModel: null`, `modelVerified: false`, and `modelEvidence: "pinned-argv"`. For Claude's `fable`, `opus`, and `haiku` aliases, the concrete provider report must belong to the requested family. Codex 0.149.0 accepts the exact `--model` argument but does not report the served model in its JSONL stream.
4. A non-empty output file.

The receipt also carries elapsed time, token usage when the CLI exposes it, and cost when available. Keep it with the arena or review artifacts so parent-harness comparisons are evidence-based.

Any missing CLI, failed login, unavailable model, explicit timeout, cancellation, catchable post-reservation launcher failure, non-zero child exit, malformed result, or model mismatch is a receipt-bearing dropout. Record it and apply the calling skill's existing dropout policy. A `cancelled` receipt represents a launcher signal and returns wrapper exit 130. After a zero exit, invalid or incomplete terminal data is `malformed-output`/65. After a nonzero exit, it takes the ordinary failure classification: normally `child-failed`/70, or `unavailable-model`/69 when the model-error text matches. Only the authentication preflight classifies a lane as `unauthenticated`/77. A nonzero child exit after the model call starts, without a provider-reported reason, is never `unauthenticated`, even when its output mentions authentication. If a login expires between the preflight and the model call, the receipt is `child-failed`/70 and keeps the CLI's error text in `error.evidence`. When an adapter parses a provider-reported failure, the receipt preserves the exact reason in `error.message`, puts it first in bounded evidence, and retains reported model/session/usage/cost and the actual child exit code, even after an ordinary nonzero child exit. Missing provider metadata stays null. Launcher cancellation and timeout take precedence. The `signal` field is non-null only when the runner sent that signal to a still-active direct CLI child, and remains null for provider-only cancellation or when launcher cancellation only stopped a post-exit pipe drain. The provider CLI owns any processes it starts beneath that direct child; the receipt does not claim a process-tree kill. Do not delete or overwrite the receipt. Never substitute the parent model, retry another provider, or reinterpret an external descriptor as a native model slug.

Start native and external lanes in the same fan-out phase, then wait for all of them before judging. A judge must not read candidate paths while their owners are still writing.
