---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
---

# Arena

**Dispatch contract.** Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before fan-out. Configured values are provider-qualified descriptors, not host-native model slugs. The parent starts native and external lanes directly; children never route themselves. On Codex, resolve the remaining Claude tool names via [`codex-tools.md`](../poteto-mode/references/codex-tools.md).

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use `arena runners` from the current harness's pstack model sheet when present. Otherwise use its [role default](../poteto-mode/references/model-catalog.md#role-defaults), one runner per entry. Spawn more runners when the arena covers multiple design directions. Use the same descriptor N times when the work is generation-bound rather than judgment-sensitive. Pick each subagent's effort for the job, per the Subagents section of the **poteto-mode** skill.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.
5. Mark the read-only seats. A runner whose provider's Access modes cell in the [route table](../poteto-mode/references/model-catalog.md#routes) lacks `isolated-write` is a read-only seat: it runs in `read-only` mode, reads the repository, and returns its complete candidate (a full patch, or the full design or prose) as its final output. It cannot iterate on tests, so read-only seats suit design and prose best. `read-only` limits the model's tools, not the CLI, so repository code may run in such a lane; seat one only on a repository you trust. Run it with `--cwd` set to its own fresh throwaway worktree of the scope, never the primary checkout or a candidate's worktree, as [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md#repository-code-in-a-read-only-lane) says. Anything written there is discarded. After taking the output file, report it if `git status` in that worktree was not clean, then remove the worktree.

## Phase B: Fan out

Start all N lanes in one fan-out phase through the provider-dispatch contract. Native lanes are background subagents. External lanes are direct background launcher processes with retained task/session handles, never foreground calls and never subagents supervising subprocesses. Give every lane the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

An external lane counts only when its receipt says `complete` and carries either a matching `provider-report` or Codex's exact `pinned-argv` evidence; a native lane counts when its tool transcript returns the assigned model's result. If a candidate fails, proceed with N-1 and note the exact dropout in the synthesis record. Never replace it with another provider silently. A missing CLI, login or model is a named dropout the same way, and the arena continues. Never substitute.

Save a read-only seat's output as that candidate. For a patch, apply it in a fresh worktree for that candidate and run the rubric's checks there. Record a patch that does not apply or fails its checks: that is a result about the candidate, not a dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, read `arena cross-judge pool` in the current harness's pstack model sheet when present, otherwise its [role default](../poteto-mode/references/model-catalog.md#role-defaults). Dispatch one read-only judge through the provider contract. The judge is never from the parent's family. For this check, a descriptor's family is its provider, so every Claude row is one family and every Codex row is another. Try only the entries from another family, in pool order. An `auto` or `inherit-parent` entry is the parent model, so it never judges. A failed entry is a named dropout, so record it and try the next entry from another family. Never swap in a model the pool does not name. If no entry from another family runs, skip the judge, pick the base alone in Phase D, and say so. The judge sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't dispatch it while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. The judge and the picker treat every candidate the same, and name which were read-only. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, which candidates were read-only and how each patch applied, and the verification result.
