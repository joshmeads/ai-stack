# Upstream synchronization

open-pstack tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack) while adapting Cursor-specific primitives for Claude Code and Codex.

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `c742dd61706fbacc1b95f1a20b7b988cf096ce6c` |
| Upstream version | `0.15.36` |
| open-pstack version | `1.16.0+jm.4` |
| Open Pstack merge | `b4c5e3d` (1.16.0) |

The table above is the current Cursor sync point and the Open Pstack release merged here. Open Pstack 1.16.0 imported the 0.15.29 sync at `88d47514b82e7c44f00f2b2a72ff6dd12158038c`, and [Cursor 0.15.30 to 0.15.36 sync](#cursor-01530-to-01536-sync) records what this repository applied on top. `README-UPSTREAM.md` preserves the upstream pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance.

## jm:stack divergence

This checkout publishes Open Pstack as jm:stack in the `jm` marketplace. It also tracks Open Pstack itself (`upstream` remote, `ericlitman/open-pstack`). These changes diverge from both upstreams; keep them when merging either one.

- **Rename.** The plugin is `jm-stack` with display name "jm:stack" in both plugin manifests, so skills are namespaced `jm-stack:<skill>`. `setup-pstack` is `setup-stack`, and the native Claude agents are `stack-<family>-<effort>`, which `registry/render.ts` generates. The SessionStart text, `poteto-agent`'s preload, `poteto-help`, `codex-tools.md`, `docs/reference.md`, and the tests use these names. Other skill names stay upstream's. Internal names stay: the `plugins/pstack/` directory, `pstack-models.md`, the `pstack:models` markers, the sheet heading, and `pstack-runner`.
- **Models.** The Grok family and the runner's Grok adapter are removed, with their matrix row, defaults, docs, and tests; Cursor's Grok is the one exception, under Grok only through Cursor below. The selectable Claude and Codex families are `fable`, `sol`, `luna`, `opus`, `haiku` and `sonnet`. `haiku` is `claude:haiku`, a rolling alias normalized and verified like Fable, Opus and Sonnet, with native agents `stack-haiku-<effort>`. Upstream registers no `haiku` alias, because Claude Code resolves it to Haiku 4.5, which has no effort setting, on Bedrock, Vertex and Foundry (#223); jm:stack keeps the alias by the owner's decision, so a lane on those hosts gets that older model. Every first-run role and every skill's built-in default uses Opus or Sol, and the panels are Opus then Sol. Every family defaults to `high` by the owner's ruling, which also sets each first-run role default and panel to `high`. SWE-1.6, Composer 2.5 and Amp's DeepSeek V4.1 Flash offer only `default`, their nearest listed effort, so they stay on it. `tests/skill-collision-repro.sh` holds this, so a merge that changes a default effort restates it as `high`. The ai-stack CLI's `[sheet.*]` rows are the owner's explicit per-role choices, not defaults, and keep their own efforts. The ai-stack CLI's per-harness sheets assign Luna or Haiku to `how explorer`.
- **Exact Claude pins.** Upstream's `opus-5-5` and `haiku-5-5` families and their `pstack-*-5-5-*` agents are not kept, and neither are their released pairs. With them registered, a sheet line such as `claude:<concrete revision>@high` would stay pinned instead of normalizing to its alias, and the ai-stack CLI writes and accepts only rolling aliases. So every `claude-<family>-<revision>` stays a version pin that read-time normalization rewrites and the runner rejects. Keep them out on a merge that changes them, and drop any new upstream pin the same way.
- **Read-only providers.** OpenCode, Amp, Cursor CLI, Devin, Antigravity (`agy`) and DeepSeek Harness (`dsh`) are kept, with their fixtures and tests, as selectable only, and `pi` joins them. No role default or panel may use them. A sheet that `/setup-stack` or the ai-stack CLI writes can select one for a role that does not write files, and both refuse one on a role that writes. `registry.test.ts` holds the CLI's matrix and writer rows to the registry and to `/setup-stack`.
- **Read-only arena seats.** By the owner's ruling, only Claude and Codex write. Any other family can take an `arena runners` seat in `read-only` mode: it reads the repository and returns its complete candidate, a full patch or the full design or prose, in its output file. The parent saves it as that candidate, and applies a patch in a fresh worktree for that candidate to run the rubric's checks. A patch that does not apply or fails is a result about the candidate, not a dropout. So `arena runners` is not a writer row in `cli/src/config.rs` or `/setup-stack`; `architect runners`, `swarm workers` and the code roles stay writers. No read-only provider gets a write mode or an OS sandbox for this. The default sheets in `cli/config.default.toml` seat four runners, by the owner's choice; first-run role defaults stay Opus and Sol.
- **Read-only lanes run in throwaway worktrees.** `read-only` limits the model's tools, not the CLI, and a real Cursor lane ran a repository's language server, which wrote into the repository. So `provider-dispatch.md` and Arena run every lane on a read-only provider other than Claude or Codex with `--cwd` set to its own fresh throwaway worktree of the scope, never the primary checkout or a candidate's worktree. The parent reports a worktree whose `git status` was not clean, and removes it after taking the output file. Seat such a lane only on a repository you trust.
- **`pi` provider.** `providers/pi.ts` is this repository's own read-only adapter for the `pi` CLI, so an OpenRouter model can take a seat, and a rolling ID resolves to its latest model. It has no upstream counterpart, so a merge leaves it as it is.
- **Grok only through Cursor.** The owner allows Grok only as a read-only Cursor lane on rows the owner chooses. There is still no Grok adapter, family default or role default, and no registered Grok family on `pi`. `cursor:grok-4.7` is that one registered family.
- **T3 Code lanes.** `provider-dispatch.md` has a T3 Code lanes section, and `interrogate` points to it. A parent inside T3 Code that launches a read-only Claude or Codex lane through `delegate_task` checks the descriptor against `orchestrator_capabilities` at dispatch. It resolves a rolling alias to the highest advertised revision of its own family, and a lane with no advertised match is a named dropout. No model version is written down anywhere for this. A T3 lane runs in plan mode on its own throwaway copy of the scope, writers keep their native or runner route, every T3 task carries the native lanes' limits, and a T3 lane completes by its task result in place of a receipt. `docs/reference.md` carries the same exception. Codex workers had been passing the bare alias, which T3 refuses, and every such review ran on one provider. `interrogate` also opens its output with a panel line that names a single-provider, reduced or empty panel. Neither upstream has these; keep them when merging either one.
- **Marketplace.** Both marketplace manifests are named `jm` and list only `jm-stack` (`./plugins/pstack`). The repo's other skills are standalone skills in `skills/`.
- **Maintainer process.** Open Pstack's own process files are removed: the `verify-open-pstack` project skill and its static check, `REVIEW.md`, `.mergify.yml`, `.github/unfret.json`, `.github/workflows/unfret-threads.yml`, `.github/workflows/windows-hooks.yml`, the `live-gate` pull request template, `.agents/babysit-pr.md`, `.agents/run-these.md`, `.agents/triage-backlog.md`, the root `package.json`, `open-pstack.code-workspace`, `README-OPEN-PSTACK.md`, and `scripts/release.py` with `scripts/release_test.py`. When an Open Pstack merge changes them, keep them deleted. The fixes they exercised stay: `plugins/pstack/hooks/`, including the Windows SessionStart fix, is upstream's. This repository's `README.md`, `AGENTS.md`, `.gitignore` and `.github/workflows/ci.yml` stay its own, and take upstream changes only where they apply. `AGENTS.md` does not take upstream's waived-finding, live-gate or Mergify paragraphs. It takes upstream's owned-code comment rule, narrowed by the owner's ruling so that a comment stays only if a tool or a user reads it. That rule applies to `cli/` and `skills/devtools-perf/`, and vendored and third-party code stays as it came.
- **Ideas from tstack.** These come from Theo Browne's MIT-licensed [tstack](https://github.com/t3dotgg/tstack) and are written in our own words; see `NOTICE.md`. `interrogate` has a round budget of 3, up to 5 for security, permissions, auth, data loss or state and concurrency while a real blocker stays open with evidence, and stops early when a round returns only nits. It also has blocker, should and nit severities with a scope rule, a ledger of findings and outcomes, "if review grew the diff, cut first", an optional per-adversary score in the PR description, and a budget end that is not approval. `opening-a-pr` checks for secrets and private details before submitting and opens through REST when GraphQL is used up. Babysit uses T3 Code's `watch_pull_request` and `unwatch_pull_request` where they exist, notes the GraphQL and REST limits, and declines review-loop growth with a written reason. Attacking the premise when one mechanism fails two rounds is this repository's own addition, from its own review history.

When a Cursor or Open Pstack change touches Grok (runner adapter, preflight, environment allowlist, default descriptors), apply only the parts that are not Grok-specific and restate any changed default as Opus or Sol. The runner contract keeps the generic adapter features Grok used (`prompt: "file"`, the preflight retry, the environment allowlist) so Open Pstack merges stay small. The Cursor CLI fixtures keep the `grok-*` lines Cursor's own model list printed, because they are captured output.

The 1.16.0 merge made two more hand resolutions. `swarm/SKILL.md` keeps Phase A's step 3 ("Set N"), which `d462f0a` removes while leaving the list numbered 1, 2, 4, 5, and which `e73df47` renumbers without restoring. `provider-dispatch.md` keeps the Descriptor spelling section, restated without literal descriptors so the role-pointer scan passes.

## Cursor 0.15.30 to 0.15.36 sync

jm:stack applies these commits on top of the Open Pstack 1.16.0 merge, directly from Cursor. Claude Code's `Agent`, Codex's `spawn_agent` and the other names map as `CHANGES.md` documents.

| Commit | Decision | Reason |
| --- | --- | --- |
| `eb4db2b` | exclude | Adds the statechart skill. The owner may adopt it later. |
| `7698375` | exclude | Statechart only. |
| `4ec7ffa` | exclude | Statechart only. |
| `076f4b2` | exclude | Statechart only. |
| `642289e` | exclude | Version bump only. |
| `00d5dec` | exclude | The paragraph in `create-formal-verification-skill` only points at `/statechart`, so it does not read sensibly without the skill. |
| `3c0fdb4` | exclude | Adds the ketchup-video skill. |
| `b1a1298` | exclude | Version bump only. |
| `7054003` | adapt | Reflect edits stay out of the plugin cache. Destinations are Claude Code's and Codex's skill folders, and the user may name the plugin's own source file when the checkout is that repository. |
| `96dec8e` | adopt | `watch-pr` no longer treats a fork head as a stack parent. |
| `fe096ef` | adopt | `watch-pr` caps polling sleeps at the deadline. |
| `86c2448` | adapt | `check-plan.mjs` takes the regular expression at the port's `toLines`. The tests use the port's `checkPlan` API. |
| `3c596e7` | exclude | Fixes `orch`, which `c742dd6` deletes. |
| `f83fbe6` | adopt | `worktree-audit.sh` picks GNU or BSD `stat` and `date` flags once. |
| `a0b0ad9` | adapt | The note on auto-update for third-party marketplaces goes in `README.md` and `poteto-help` with jm's install commands. `README-UPSTREAM.md` takes upstream's text verbatim. |
| `e73df47` | adapt | The port already numbers Swarm's Phase A 1 to 5 and keeps its step 3 "Set N", so only the Phase D wording, "a result table", applies. Phase B names no step number in the port. |
| `34b1b7c` | exclude | Statechart only, apart from README text that `README-UPSTREAM.md` takes verbatim. |
| `7c7bde7` | exclude | Version bump only. |
| `740d2c0` | exclude | Statechart only. |
| `164ced1` | exclude | Version bump only. |
| `519d36a` | exclude | Statechart only. |
| `ab1f702` | adapt | Decided per bullet below. |
| `c742dd6` | adapt | Orchestrate is agentic and the `orch` scripts and their test entry are deleted. Mapping below. |

`ab1f702`, per bullet of its message:

| Bullet | Decision | Reason |
| --- | --- | --- |
| poteto-mode restates the user's goal | adopt | |
| poteto-mode backgrounds steers and resumes | adapt | A Claude Code subagent still waits as Waits on Claude Code says. |
| poteto-mode chains fallbacks when the `Task` tool rejects a slug | exclude | No silent substitution. The port has no slug rejection path, and an unavailable model stays a named dropout. |
| poteto-mode applies Explain the Number before measuring | adopt | |
| Autopilot blocks a PR only for a problem a run or a wrong doc line shows | adapt | Taken with its follow-up rule. Step 4 keeps one fix-forward to the owner and the one-writer rule. |
| Autopilot pushes each finished unit | adopt | |
| Wording-only changes get no verifier | adopt | Autopilot-full and the multi-phase plan. |
| Autopilot-stack is Autopilot-full without the merge | adapt | Rules and reasons taken per #191, below. |
| Interrogate adversaries prove findings with a run, and the lead keeps what a rerun confirms | adapt | Reviewers stay read-only against the repository, below. |
| Interrogate drops the reviewer, rubric, lead-judgment and code-quality references | adopt | |
| Arena drops or replaces a rejected runner seat | exclude | No silent substitution. A runner failure stays a dropout with N-1 candidates. |
| Arena's judge comes from another family | adapt | Below. |
| ketchup-video subtitles | exclude | The skill is excluded. |
| principle-explain-the-number writes the decision before the run | adapt | The description keeps `user-invocable: false` and drops `disable-model-invocation`, as for every principle leaf. |
| Orchestrate copies store files to local disk once | exclude | `c742dd6` removes the line, and the port's program directory is already local. |
| Stacked PRs rebase onto their parent branch | adapt | Autopilot-stack's root rebases each link onto its parent's exact tip through step 2's guarded flow. |
| Setup describes the cross-judge pool | adapt | Provider in place of family, as for Arena. |
| The README and guide | adapt | `README-UPSTREAM.md` is verbatim. The guide is excluded. `poteto-help`'s statechart and ketchup-video rows stay out. |

The same commit also drops `interrogate` from what a PR-opening subagent runs in `opening-a-pr.md`, and that hunk is taken: a subagent cannot fan out on Claude Code, and the lead runs the major review.

**Interrogate.** The dispatch contract, read-only access, receipts and dropout rule stay. "Prove with a run" means a harness outside the repository, under `$TMPDIR`, or a command that writes nothing. A Codex read-only lane cannot write anywhere, so its brief lets it hand the lead a complete repro marked `not run`. The lead reruns each command in scratch or a fresh worktree after reading it. Upstream's per-adversary worktrees stay out, because a Claude or Codex read-only lane reads the checkout as it is. A lane on another provider takes the throwaway worktree above.

**Arena.** A descriptor's family for the judge check is its provider, which is upstream's prefix rule in the port's terms: every Claude row is one family. So the second entry of each default sheet's pool never judges on its own harness. A failed entry is a named dropout and the next entry from another family runs. Upstream's walk to the default pool and its nearest-slug rule stay out, so a pool with no usable entry skips the judge. Upstream's unknown-parent branch stays out, because the parent always knows its provider. Phase A step 3 keeps the port's text.

**Orchestrate.** `c742dd6`'s names map as follows.

| Cursor | Claude Code and Codex |
| --- | --- |
| `Task` | Provider dispatch: `Agent` or `spawn_agent` natively, the launcher otherwise. |
| Project tracker (`notes.md`) and Project store | `<config-home>/orchestrate/<project-slug>/notes.md`, with kickoffs and reports beside it. The todolist does not outlive a session. |
| PR and CI event subscriptions | Neither harness has them. Each owner waits on its PR through Babysit, and its completion notice wakes the coordinator. T3 Code's watcher applies where Babysit step 6 says. The Autopilot-full audit tick covers an agent that never reports. |
| Cloud VMs (`environment: "cloud"`) | Background subagents and launcher processes on this machine, one worktree per writer. |
| Fork | Poteto-mode's Fresh subagents rule: reuse a worker only for state it holds. |
| `control-ui`, `control-cli` | The real UI, driven with whatever browser or GUI automation the session has; `run`. |

Three rules stay stricter than upstream's text. An owner rewrites and merges only through Autopilot-full step 2 and Shipping step 5. A worker is stopped only on affirmative failure evidence, per the existing stuck-agent exclusion, so "no activity" is drift. A retry after a tool error names another configured role's model in the report, and an unavailable model stays a dropout. The port adds a session-restart rule, because local subagents die with the session and Cursor's cloud workers do not.

**Autopilot-stack (#191).** The header, step 1's stop at verified, the no-push-after-handoff rule, the tick prompt naming the file, and "a PR stacks only on a PR it builds on" come from `ab1f702`. Step 2 keeps the fork and topology rules, and the root stays the one writer of a chain's topology. So upstream's "each PR rebases onto its parent" is the root's job for a link, and an independent PR's owner rebases it through Autopilot-full step 2. Babysit step 4 says the same. The named landing invariants are unchanged.

## Upstream-only exclusions

- Upstream's statechart skill (`eb4db2b`, `7698375`, `4ec7ffa`, `076f4b2`, `34b1b7c`, `740d2c0`, `519d36a`) and `00d5dec`'s pointer to it, and the ketchup-video skill (`3c0fdb4` and its `ab1f702` bullet), are not imported. `scripts/upstream-audit.py` lists them with `make-bot-ui` in `EXCLUDED_SKILLS`, so a merge leaves them unmapped. The owner may adopt statechart later.
- The 0.15.30 to 0.15.36 Cursor manifest bumps and `pstack/docs/guide/` edits are not applied, as for the earlier bumps below.
- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`, and `a968159` renames it after its folder. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share. `a968159`'s other hunk names `poteto-mode` after its folder, which the port's `poteto-mode/SKILL.md` already does.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` from `23a56e2`, `889ec4b`, and `70b2dc8` are not applied. Those frequent code-writing roles stay on Sol, `codex:gpt-6.1-sol@high` in jm:stack.
- `5bf2b15`'s setup budget question, its `# budget` line, and its step down to a lower detected effort are not applied. Setup already asks one requested effort per assigned family, and the step-down would silently lower a requested effort.
- `12d587d`'s rule that reruns a rejected configured entry on its family default or the closest valid slug is not applied, and neither is `ce649c0`'s rule that puts `cursor-grok-*` and `composer-*` entries in the Grok family for that fallback. An unavailable model stays a named dropout per `provider-dispatch.md`.
- The expected-runtime column in `70b2dc8`'s `children.tsv` and its expected-runtime stuck test are not applied, and neither are `ce649c0`'s stuck-after runtime and its rule that an owner with no push or trail row by the first tick is stuck. A lane is stuck only on affirmative failure evidence. An owner with no push or trail row at a tick is drift for that owner to record.
- The explicit Grok, Opus, and Sol defaults for the Why and Reflect roles are not applied. Those roles stay on `inherit-parent` because the external runner omits the parent's MCP servers.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.
- Commit `df58112` (pstack 0.15.15) is not applied. It drops Sol from every default, cuts the panels to Opus and Grok, and moves Opus from `max` to `xhigh`. Open Pstack keeps its own model defaults and three-model panels; jm:stack keeps Sol and uses an Opus and Sol panel (see jm:stack divergence).
- The `disable-model-invocation: true` lines that `23e4138` puts on `benchmark-checklist` and `principle-explain-the-number` are not applied. The same flag, which upstream carried on principle leaves and `figure-it-out` before 0.15.5, stays off as in earlier syncs. Principle leaves keep `user-invocable: false`, and `figure-it-out` and `benchmark-checklist` stay model-invocable because poteto-mode routes to them by name. The typed-only `correct`, `poteto-help`, `in-your-own-words`, and `sharpen` keep the flag.
- The Built-in PR tool paragraph from `23e4138` and `00b14f1` is not applied. It describes a Cursor run tool that Claude Code and Codex do not have.
- The 40-line squash-body cutoff returns in `00b14f1` and stays omitted, as in the 0.15.0 sync.
- Autopilot-full step 5's trunk-move rule from `23e4138`, and its revision in `ce649c0`, are not applied. The `23e4138` rule merged without another rebase when `git merge-tree` was clean and trunk touched none of the PR's paths or CI paths, and both checks pass when trunk removes an export that the PR's new code imports. `ce649c0` replaces those checks with the owner's judgment: merge when trunk's changes cannot affect the patch, and run the patch's checks on the merge result when trunk changed a caller or a dependency. An owner who misses a dependency still merges an untested tree. Step 5 keeps the rebase at merge prep and sends a trunk move before the merge through the patch ID rule in `playbooks/shipping.md`. `ce649c0`'s lockfile exception and its hold before a third rebase go with the rule.
- `poteto-agent.md` does not take `is_background: true` from `2bd5dd4`. Claude Code documents `background`, not `is_background`, in agent frontmatter, and Codex defines agents in TOML and maps concurrency at dispatch. The port keeps `general-purpose` in the description and the `skills: [pstack:poteto-mode]` preload.
- The root Agent Plugins v1 `pstack/plugin.json` from `e5a02f8` and its version bumps through 0.15.25 are not applied. The port keeps its current Claude manifest at `plugins/pstack/.claude-plugin/plugin.json` and Codex manifest at `plugins/pstack/.codex-plugin/plugin.json`. Agent Plugins v1 is revisited with #13.
- `unslop` takes `bc697d0`'s description without its `disable-model-invocation: true` line, as for `73f8be4` above.
- `pstack/.cursor-plugin/plugin.json` and `pstack/docs/guide/` are not imported. The Cursor manifest has no Claude Code or Codex consumer, and the guide shows Cursor's interface; `poteto-help` links to the guide upstream. That covers the 0.15.21 to 0.15.25 version bumps and `e5136d8`'s guide edit.
- Upstream's own Claude Code install is not applied. That covers `182f2ce`'s and `1b80080`'s generated tree under `harness/pstack/claude-code/`, `scripts/generate-pstack-harness-trees.mjs`, `scripts/validate-plugins.mjs`, the root `.claude-plugin/marketplace.json` entry, the adapter at `pstack/docs/harness/claude-code.md`, and `a968159`'s generator change. That install runs `grok-*` and `gpt-*` roles on the session's Claude model, has no Codex, and maps Cursor names at runtime from the adapter, which would be a second mapping layer on top of the port's own. `README-UPSTREAM.md` takes the README text from `182f2ce`, `1b80080` and `019a6a2` verbatim.
- `019a6a2`'s guide refresh and `scripts/check-pstack-docs.mjs` are not applied. The port does not import `pstack/docs/guide/`, so that check has nothing to compare. The same covers the guide edits in `7b353f7`, `f9be7aa` and `d457567`.
- The two harness paragraphs that `f9be7aa` puts in `poteto-help/SKILL.md`, which install upstream's Claude Code tree and describe other tools, are not applied. The port keeps its own paragraph on Claude Code and Codex.
- The 0.15.26 to 0.15.29 manifest bumps in `pstack/plugin.json` and `pstack/.cursor-plugin/plugin.json` from `0b8e952`, `0148b78` and `d457567` are not applied, as for the earlier bumps above.
- `create-formal-verification-skill` takes `4382e68` without its `disable-model-invocation: true` line, because setup's formal verification offer invokes it and the flag blocks that route on Claude Code. `tests/skill-collision-repro.sh` lists it in `routed_model_skills`. `maintain-formal-verification-skill` keeps the flag and runs only when typed.
- Setup's verification offers are steps 10 and 11 in the port, after its step 9 smoke test. The port never took upstream's step 7, "Offer a verification skill", which upstream has carried since 0.11.3. This sync restores it as step 10, and `f9be7aa`'s formal verification offer becomes step 11. Each keeps upstream's check for a project that already has one.
- `poteto-agent.md` does not take `b93e811`'s search of `~/.cursor/plugins/` for poteto-mode, its highest-version rule, or its note that the skill catalog hides poteto-mode. The Claude agent preloads `pstack:poteto-mode`, the port's poteto-mode is not hidden, and Codex has no `poteto-agent` type. The agent keeps upstream's "Use the absolute path your parent gave you."

## Local port-patch ledger

- **#235 — Claude transcript folder encoding**: the port wrote Claude Code's per-project transcript path into `recall`, `automate-me` and the `session-pickup` playbook. Claude Code encodes each `/` and each `.` in the workspace path as `-`, so a `.claude/worktrees/` session's folder holds `--claude-worktrees-`. Keep both characters in those three lines during syncs.
- **#140 — Reflect transcript resolution**: Cursor's Reflect step 1 reads the `agent-transcripts/` directory its system prompt names; the port had substituted Claude Code's per-project directory, which left Codex without a lookup. The port replaces that step's body with one line that points to `plugins/pstack/skills/poteto-mode/references/codex-tools.md#active-transcripts`, and leaves the rest of `reflect/SKILL.md` unchanged. That mapping section holds the harness specifics: the Claude per-project scope, layouts, candidate and scan limits, opening-message verification, the Codex resolver call, and the 2,000-word digest fallback. The port-authored Bun resolver `plugins/pstack/skills/poteto-mode/scripts/resolve-codex-transcript.ts`, started through the `sh` launcher `resolve-codex-transcript` next to it so project Bun config and `.env` files cannot affect it, looks up the parent's known chat ID in Codex's read-only `threads` index, checks rollout scope and ownership, and prints opening-message metadata without transcript text. Preserve this divergence during upstream syncs: keep step 1 as the one-line pointer and keep the mapping section and resolver.
- **#120 — harness config homes** (tracked for #105): Cursor's setup destination is `~/.cursor/rules/`. The shared port resolves nonempty `CLAUDE_CONFIG_DIR` / `CODEX_HOME`, otherwise `$HOME/.claude` / `$HOME/.codex`, once at `plugins/pstack/skills/poteto-mode/references/codex-tools.md#harness-config-homes`. `setup-stack/SKILL.md` reuses that home for reads, sheet/integration writes, snapshots, restoration, and readback; Claude preserves the literal legacy import at the default home and renders exactly `@./pstack-models.md` for redirected homes, keeping spaces and `#` in the config-directory name out of the import line; reruns replace the one import whose target basename is `pstack-models.md`, append if absent, and stop if duplicated. Preserve this intentional divergence during upstream syncs. The named config-home invariant in `tests/skill-collision-repro.sh` rejects literal default destinations outside the legacy import, requires the literal default-home rendering and zero/one/many import rules, and verifies unset/empty/space-containing resolution without daily writes. See `CHANGES.md` for the port correction and `tests/setup-config-home-repro.sh` for redirected live-evidence preparation. The Cursor sync point is unchanged.

- **#157 — role pointers**: Cursor names model descriptors in the Arena, Architect, How, Interrogate, and Swarm skills, the bug-fix, feature, hillclimb, perf-issue, and refactoring playbooks, poteto-mode's delegation defaults, and setup's probe table and first-run sheet. The port replaces each with a role pointer: the role's backticked sheet label and a link to `plugins/pstack/skills/poteto-mode/references/model-catalog.md#role-defaults`, which `registry/render.ts` generates from `plugins/pstack/skills/poteto-mode/scripts/runner/registry/models.ts`. Interrogate's reviewer table and setup's probe table and example sheet are deleted. When an upstream sync changes a model slug on one of these lines, keep the port's line and put the model change in `registry/models.ts`. `runner/registry.test.ts` enforces the rule: `ROLE_POINTERS` names each file's roles, and its text scan rejects any descriptor or versioned model name in `plugins/pstack/**/*.md`, `README.md`, and `docs/reference.md` outside the generated catalog and agents.

- **#46 — quiet setup reruns**: Upstream's setup has no keep-roles, per-family effort, or write-confirmation questions, so this is a port patch. `setup-stack/SKILL.md` states one qualifying-rerun exception before step 2's keep-roles question. On a rerun whose sheet loaded with one valid setting line, with no change named and no inconsistency or kept-predecessor proposal that needs a choice, setup validates in step 3, keeps and prints the roles and efforts instead of asking steps 2 and 4, and writes without step 7's confirmation when every step 5 probe passes. Steps 4, 7 and 8 and the offers in steps 10 and 11 each name the exception. It skips no validation, permission check, snapshot, readback, or the step 9 smoke test, and a failed probe still stops without writing. `poteto-help` says the same for reruns. Preserve this divergence during upstream syncs.

- **#191 — landing playbooks and per-spawn effort**: `ce649c0` cuts Shipping to six steps and both autopilots to principles. The port takes the cut's rules and reasons but keeps the landing procedure from 1.3.0: Shipping keeps steps 1 to 9, Autopilot-full step 2 holds the guarded rebase and push, and Autopilot-stack step 2 holds the fork and topology rules. Those steps disarm auto-merge and merge-queue entries before verification and before any rewrite, keep the verdict head and base apart from the landing head and base, resolve the base fetch remote apart from the head push URL, bind each push to a captured SHA, and merge only through a server-enforced expected head. The named landing invariants in `tests/skill-collision-repro.sh` check those rules by step and phrase, so a sync that moves them updates the invariants in the same change. `ce649c0`'s Match the model to the job rule is taken with port adaptations: the starting level is the role's configured effort, an unlisted effort moves to the nearest effort the catalog row lists, a configured `ultra` stays, and the fast and standard speed sentences are dropped because the port's descriptors carry no speed selector.

- **#232 — subagent waits in babysit**: Cursor's babysit step 6 runs `drive` and `background` under `/loop`. Claude Code subagents have no `ScheduleWakeup`, so `/loop` cannot run in them. The port adds one sentence after the `/loop` sentence that limits `/loop` to the main session and points a Claude Code subagent to `plugins/pstack/skills/poteto-mode/references/codex-tools.md#waits-on-claude-code`, which holds the wait rules. Preserve this sentence during upstream syncs.

- **UI proof without `verify`**: Cursor routes UI proof through `control-ui`, which the port once mapped to Claude Code's `verify`. `disable-model-invocation` on that built-in makes the Skill tool refuse it, so the playbooks and `poteto-mode` now say `run` for CLIs and TUIs and, for UIs, drive the real UI with whatever browser or GUI automation you have. `codex-tools.md` holds the fuller wording. No plugin skill names a standalone UI skill, because a plugin skill must not depend on one. A verdict still needs a live lane. Keep this during syncs, and map any new `control-ui` line the same way.

- **`ketchup` is model-invocable**: upstream's `ketchup` carries `disable-model-invocation: true`, but Autopilot-full and Autopilot-stack route through it, and the flag blocks that route on Claude Code. The port drops the flag and shortens the description, since it now costs context. `tests/skill-collision-repro.sh` lists it in `routed_model_skills`. Keep both during syncs.

- **Prefixed agent names on Claude Code**: Claude Code registers plugin agents as `jm-stack:<agent>` and refuses a bare name with "Agent type not found". Text that tells Claude Code to dispatch an agent uses the prefix (`jm-stack:stack-<family>-<effort>`, `jm-stack:poteto-agent`, `jm-stack:comment-sicko`), and `registry/render.ts` generates the catalog's column the same way. Agent file names and the `name` frontmatter stay bare, and Codex text keeps its own names. Apply the prefix to any upstream `subagent_type` or agent name a sync brings in.

- **Skill authoring without `plugin-dev`**: Cursor routes authoring to `/create-skill`, which the port once mapped to `plugin-dev:skill-development`. That skill is in a separate plugin, so it is often not installed, and a plugin skill must not depend on it. `create-skill` now maps to `playbooks/authoring-a-skill.md`, whose step 1 states the frontmatter and body rules, and `poteto-mode`, `automate-me` and `reflect` point there. Reflect's routing label is `new skill: <kebab-name>`. Map any new `create-skill` line the same way.

## Check for changes

The repository already names Cursor's repository as the `cursor` remote in the maintainer checkout. A fresh clone can add it once:

```shell
git remote add cursor https://github.com/cursor/plugins.git
```

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch cursor main
git log --oneline c742dd61706fbacc1b95f1a20b7b988cf096ce6c..cursor/main -- pstack
git diff --stat c742dd61706fbacc1b95f1a20b7b988cf096ce6c..cursor/main -- pstack
```

No output means the tracked pstack tree has not changed. This comparison does not need a polling service or generated mirror branch.

## Incorporate a change

1. Create or update a GitHub issue in `joshmeads/ai-stack` and branch from current `main`. Pin the upstream target commit in the issue.
2. Read each upstream pstack commit in order, and record a decision for each one in the issue as a table: adopt, adapt (name the adaptation), or exclude (give the reason). Bring over each adopted commit's intent and content, then apply only the Claude Code and Codex substitutions documented in `CHANGES.md` and the adaptations in this file.
3. For a Cursor sync, run the audit and the mechanical merge from a clean checkout. For an Open Pstack sync, run `git merge --no-ff --no-commit upstream/main` instead.

   ```shell
   python3 scripts/upstream-audit.py --port HEAD --upstream <target> > audit.json
   python3 scripts/upstream-merge.py audit.json
   ```

   The merge checks out files the port never changed, merges the rest three ways, and prints counts of verbatim, clean, review and unmapped paths. It exits 1 when any path needs review.
4. Resolve each review row by hand. A conflict hunk keeps the port's adaptation and takes upstream's new intent beside it. A change to an excluded path stays out and extends that exclusion's line in this file. Each unmapped path, such as a Cursor manifest or the guide, is excluded or mapped by a decision in step 2. Record every hand resolution and every new adaptation or exclusion in this file.
5. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and provider routing in `provider-dispatch.md`; do not fork a skill per harness.
6. Update the commit and version in this file, add a provenance row to `NOTICE.md`, and take `README-UPSTREAM.md` when upstream changes its README.
7. Run CI-equivalent checks locally, then run the installed Claude Code and Codex behavioral lanes required by the changed surface. Unit tests alone are not a release gate.
8. Merge the reviewed PR into `main`. This repository has no release script. Version bumps follow the plugin version rule in `AGENTS.md`.

Cursor's version and open-pstack's version are independent. Cursor's version identifies the imported content; open-pstack's version identifies the cross-harness distribution.
