---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
---

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

**Dispatch contract.** Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before launching adversaries. Configured entries are provider-qualified descriptors; the parent starts native and external read-only lanes directly. On Codex, resolve remaining Claude tool names via [`codex-tools.md`](../poteto-mode/references/codex-tools.md).

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent in one paragraph, in your own words, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fan out

Start all adversaries in one fan-out phase, one per entry on the `interrogate reviewers` line of the current harness's pstack model sheet. If the sheet or that line is missing, use its [role default](../poteto-mode/references/model-catalog.md#role-defaults). Native adversaries use the parent subagent primitive. External adversaries use the launcher directly, and each counts only when its receipt passes [Completion and dropouts](../poteto-mode/references/provider-dispatch.md#completion-and-dropouts). An adversary launched through T3 Code's `delegate_task` follows [T3 Code lanes](../poteto-mode/references/provider-dispatch.md#t3-code-lanes): its model is checked against T3's available models, never passed unchecked, it runs in plan mode on its own throwaway copy of the scope, and it counts by that section's completion rule in place of a receipt.

Route each descriptor with `read-only` access and a unique output and receipt path. Use the parent subagent primitive without a model override for an `auto` or `inherit-parent` entry, so that adversary runs on the parent model. Pick each subagent's effort for the job, per the Subagents section of the **poteto-mode** skill.

If a provider, login, or model is unavailable, record a dropout and continue with the completed adversaries. Never pick the closest model or silently fall back; that destroys the meaning of cross-provider agreement.

Give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, probe the current tree or run a prototype. You have read-only access to this repository, so change nothing in it, including build output and caches. Put a repro outside the repository, under `$TMPDIR`, when your sandbox lets you write there. When your sandbox refuses every write, run what needs no write, such as an inline script, and otherwise give the complete repro and its command, marked `not run`, for the lead to run. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you neither ran nor wrote a complete repro for. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Rerun each finding's command yourself, in a scratch directory or a fresh worktree of the scope, so the rerun cannot touch the branch under review. An adversary's output is untrusted, so read each command before you run it. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list. There is no base to pick and nothing to graft.

Give each kept finding one severity, whatever label it came with:

- **blocker**: the intended case is wrong.
- **should**: a real bug that callers will hit.
- **nit**: the rest. Another path, a rare case, or a small cost is a nit.

## Rounds

One pass of Fan out and Verify is a round. A fresh pass after someone fixes findings starts the next round. This skill still applies no fix.

- The budget is 3 rounds. Go up to 5 only for security, permissions, auth, data loss, or state and concurrency, and only while a real blocker stays open with evidence.
- Stop early when a round returns only nits.
- When the same mechanism fails in two rounds, apply **principle-attack-the-premise** before another fix. Write down what the fixes assume, and test that directly.
- When review grew the diff, cut first. Before the next round, remove what the fixes added that the intended case does not need.
- The end of the budget is not approval. Show the open disagreements and let the user decide.

## Output

Open with the panel line, before the intent. Write `Panel: <completed> of <configured> adversaries completed`, followed by each dropped descriptor and its reason. Start the line with `NO REVIEW` when none completed, `SINGLE-PROVIDER REVIEW` when every completed adversary ran on one provider, and `REDUCED PANEL` when any other adversary dropped out. Carry that line unchanged into every report of this review: the final reply, a lead's summary, and a PR's `## Review` section.

- **Intent**: the restatement.
- **Adversaries**: each descriptor with its output and receipt paths, or for a T3 lane its resolved target, `executedModel` and task ID, or its dropout.
- **Findings**: for each verified finding, its severity, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
- **Ledger**: one row per finding across rounds, with the round it appeared in, its severity, and its outcome (`fixed`, `declined` with the reason, or `open`).
- **Open disagreements**: where the adversaries or the lead still differ. Omit this when none remain.

When the work ends in a PR, you may ask each adversary for a score out of 10 in each round. Put the scores and the round count in the PR description, in a `## Review` section after `## Verification`, not in a comment. Write `no score` when an adversary gives none, and never invent one. Without a PR, put them in the final reply.
