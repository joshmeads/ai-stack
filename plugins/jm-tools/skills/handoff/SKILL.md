---
name: handoff
description: Write a continuation packet so unfinished work can resume in a fresh Claude Code or Codex session without the old transcript. Use when the user wants to continue in a fresh session, reset or clear context, hand off to a new task, or preserve unfinished work before clearing.
---

# Handoff

Write a packet that lets a fresh session continue the work without reading the old transcript. When the current reasoning is sound and only context pressure is high, compaction may be enough; use this skill when the user wants a clean start or durable continuation state.

Only the lead session writes handoffs. Subagents report evidence to their parent and never write handoff files.

## Build the packet

Include the sections that apply, in this order:

```md
## Objective
## Current state
## Decisions and constraints
## Changes and repository state
## Verification evidence
## Open questions or blockers
## Exact next action
```

- Objective: the user's exact request and the agreed scope.
- Current state: what is done, what is in progress, and approaches that failed.
- Decisions and constraints: choices made, and limits from the user or the repository.
- Changes and repository state: branch, commits, changed paths, whether the worktree is dirty, and any concurrent or protected work. Run `git status --short` and record the result.
- Verification evidence: exact commands and their actual results. Mark anything unverified.
- Open questions or blockers: only what is still unresolved.
- Exact next action: one executable step, not a request for acknowledgement.

Use stable names and exact paths, commands, and identifiers. Leave out narration and stale exploration. Do not repeat global instructions, memory, or repository guidance the next session loads on its own.

## Save it

When a repository root exists (prefer the VCS root, not the current directory):

1. Write the packet to `<repo>/.handoffs/latest.md`, starting with a header:
   ```yaml
   ---
   handoff_id: YYYYMMDDTHHMMSSZ-short-task-slug   # UTC
   created_at: <UTC ISO-8601 timestamp>
   repository_root: <absolute path>
   ---
   ```
2. If `latest.md` already exists, move it to `.handoffs/archive/<its handoff_id>.md` first. Never discard an earlier packet.
3. Keep the directory out of git: add `.handoffs/` once to `.git/info/exclude` if it is not already there. Do not edit a tracked `.gitignore`, and do not commit handoffs unless the user asks.
4. Copy only continuation-critical evidence (a screenshot, a short log) into `.handoffs/artifacts/<handoff_id>/`. Never copy secrets, credentials, build outputs, or dependency trees.
5. Check that every path the packet names exists.

When there is no repository, return the packet inline unless the user names a project-local destination. Never write to a global handoff directory.

## Continue in a fresh session

Return the packet in one copyable block with the matching instructions:

- Claude Code: run `/clear`, then paste the packet. Or start a new session and give it the packet as the first message.
- Codex desktop: start a new task containing only the packet, in the same project and environment; create it with the task tool when one is available. Do not fork the old task, because a fork copies its history.
- Codex CLI or IDE: run `/clear`, then paste the packet.

Tell the user what to do; never automate keystrokes, terminal input, tmux timing, or clipboard writes. Do not delete or archive the old session unless the user asks.

## Quality check

Before returning, reread the packet as the next session will: it must make sense without the old transcript and end with one executable next action.
