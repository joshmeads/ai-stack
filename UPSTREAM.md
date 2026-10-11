# Upstream synchronization

open-pstack tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack) while adapting Cursor-specific primitives for Claude Code and Codex.

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `adf3218ca2f5b9971eedc07a76bef22df7701539` |
| Upstream version | `0.15.5` |
| open-pstack version | `1.4.1` |

The table above is the current Cursor sync point for this personal fork source sync. Package metadata stays at Open Pstack 1.4.1; this is not a new tagged release. The last pstack change in the target tree is `12d587dfb207`. The previous baseline was `f8abeddd1862dc73704e3d719dd73df0d51b8c71` (0.15.1). `README-UPSTREAM.md` preserves the upstream pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance.

## Upstream-only exclusions

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The model-default changes in `889ec4b` and `70b2dc8`, and closest-model fallback rules in `12d587d`, are not imported. Explicit task-discipline policy takes precedence: architecture/review use Astra high, with Fable high only if unavailable; implementation uses Opus 5.5 high, then Astra medium, then Sol high after recorded unavailability. Mixed-model review panels are not used under that policy. The older provider-qualified runner matrix and its example defaults remain unchanged because the runner does not support the new selectors; they do not override user policy. No runner expansion or silent fallback is part of this sync.
- Setup's reasoning budget is translated to the existing per-family `@effort` flow. Unsupported efforts require an explicit choice rather than a closest-slug downgrade. Retired rows are removed in memory and shown at confirmation; failed probes leave both files untouched. Setup refuses to overwrite an explicit policy its legacy matrix cannot encode.
- The plan checker already resolves the configured `swarm workers` role and retains its stronger structural checks; it does not adopt Cursor's raw model-slug regex. Runtime supervision retains affirmative failure evidence instead of elapsed-time cancellation. Forge identity, explicit leases, expected-head merges, fork ancestry, and installed live-evidence gates remain port adaptations.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.

## Check for changes

The repository already names Cursor's repository as the `cursor` remote in the maintainer checkout. A fresh clone can add it once:

```shell
git remote add cursor https://github.com/cursor/plugins.git
```

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch cursor main
git log --oneline adf3218ca2f5b9971eedc07a76bef22df7701539..cursor/main -- pstack
git diff --stat adf3218ca2f5b9971eedc07a76bef22df7701539..cursor/main -- pstack
```

No output means the tracked pstack tree has not changed. This comparison does not need a polling service or generated mirror branch.

## Incorporate a change

1. Create or update a GitHub issue in `ericlitman/open-pstack` and branch from current `main`.
2. Read each upstream pstack commit in order. Bring over its intent and content, then apply only the Claude Code and Codex substitutions documented in `CHANGES.md`.
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and provider routing in `provider-dispatch.md`; do not fork a skill per harness.
4. Update the commit and version in this file, the affected provenance rows in `NOTICE.md`, and `README-UPSTREAM.md` when upstream changes it.
5. Run CI-equivalent checks locally, then run the installed Claude Code and Codex behavioral lanes required by the changed surface. Unit tests alone are not a release gate.
6. Merge the reviewed PR before tagging the next open-pstack release.

Cursor's version and open-pstack's version are independent. Cursor's version identifies the imported content; open-pstack's version identifies the cross-harness distribution.
