# Installed skill invocation

## Sub-features

Every registry skill is its own required feature. Include changed arguments, routing, consumed references, helper actions, and removal behavior. Principle leaves are model-invocable, not slash-menu entries. `project-skill` separately verifies this repository-local skill's discovery.

## How to get to it (user POV)

In the fresh isolated Claude session invoke `/pstack:<name>`. In Codex use the installed skill selector or `$<name>`. Invoke principle leaves through the model's native skill tool. For self-test invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex.

## Driving it with verify-open-pstack

Launch the prepared harness with its recorded launcher. For each selected name, use a disposable fixture appropriate to its documented input, invoke the installed surface, and exercise every changed sub-feature. Observe native tool/skill loading and a concrete fixture effect, not the assistant saying it passed. Save the transcript and an artifact showing the actual result (diff, generated file, tool receipt, or UI capture). Include input, expected result, observed result, and each changed sub-feature in the operator review.

For `project-skill`, invoke the discovered skill and ask it to run `verify.sh doctor` into a new child directory of this run's evidence root; forbid recursive `run`/publication. Preserve the native invocation transcript plus the resulting `doctor.json`, checking the executable path resolves to the pinned project skill. The Codex symlink and Claude canonical directory must both be discovered in fresh sessions.

## Gotchas

A generic prompt about a skill is not native invocation evidence. A list of discovered skills is not behavioral proof. If an invocation would merge, queue, release, or access daily state, use a safe disposable fixture or record failure; do not weaken the gate. Never use the child verifier to publish a status.
