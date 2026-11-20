---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
---

# How

Explore the codebase to answer "how does X work?" questions.

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

**Dispatch contract.** Resolve the lane through [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md). It runs in `read-only` mode on the `how explainer` descriptor, or that role's [role default](../poteto-mode/references/model-catalog.md#role-defaults) when the sheet lacks the line. A native lane uses the parent subagent primitive; an external lane uses the launcher directly. On Codex, resolve remaining Claude tool names via [`codex-tools.md`](../poteto-mode/references/codex-tools.md). Pick the lane's effort for the job, per the Subagents section of the **poteto-mode** skill.

## 1. Explain

Start one read-only lane that explores and explains in one pass. Give it the user's question and this brief:

> You are writing an architectural explanation for a senior engineer. Explore the codebase and write an explanation that a senior engineer unfamiliar with this area could read and walk away with a solid mental model. They should understand the architecture well enough to start working in it confidently. You have read-only access to the codebase.

## 2. Present

Present the lane's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.
