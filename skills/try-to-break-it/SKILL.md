---
name: try-to-break-it
description: Adversarially exercise a feature, change, or integration when asked to try to break it, test adversarially, or check logic and security failures. Produce reproducible evidence; not a generic style or architecture audit.
---

# Try to break it

Complement `prove-it-works` and normal functional verification with focused attempts to violate expected behavior. Apply across web, native/iOS, desktop/Electron, CLI, and backend/API applications, including the combined behavior of an integration branch. Scale the work to the change; do not impose an exhaustive audit on trivial edits.

## Respect the task and routing

Read the shared [task-discipline](../task-discipline/SKILL.md) skill before acting. Retain its scope, autonomy, testing, and model preferences. Review and architecture use Astra high; Fable high is allowed only on documented Astra unavailability, subject to explicit user overrides. Prefer an independent eligible reviewer when available. The parent selects and records routing; children neither delegate nor reroute themselves. Never quietly substitute an unauthorized model. Report any blocked review role and complete independent authorized checks. Repairs within authorized implementation follow task-discipline's implementation model policy.

## Establish what must hold

Identify the requested behavior, actual revision or working-tree changes, integration base and combined scope, relevant environment, and real entrypoints. Read applicable repository instructions and inspect the implementation and contracts. Treat implementer summaries and green tests as leads, not proof.

State the boundaries and invariants that matter: who may act on which data, valid state transitions, ownership of side effects, and what must survive failure. Follow nearby code only into dependencies relevant to changed behavior. For integrations, examine shared state and ordering across features rather than assuming isolated feature checks prove their combination.

## Choose concrete attempts

Select plausible, high-impact scenarios proportionately to exposed boundaries and consequences. Use relevant lenses, not a mandatory checklist:

- Authorization and tenant boundaries; untrusted input reaching privileged operations, queries, rendering, or filesystem sinks.
- Duplicate or partial operations, retries, concurrent requests, and invalid or stale state.
- Cancellation, restart, offline operation, reconnect, and dependency failures.
- Resource use or performance where material; interactions among integrated features.

For example, replay an API mutation after a lost response; reconnect an iOS client with stale edits; close an Electron window during a write; interrupt a CLI operation and retry. Choose only examples supported by the actual behavior and contracts.

## Execute and preserve evidence

Exercise actual code and entrypoints using existing tests, temporary probes, UI/API flows, or fault injection. Inspect relevant contracts at the boundary being tested. For each meaningful attempt, record the revision/environment, setup and inputs, expected versus actual result, reproducible steps or command, and relevant code locations or captured output.

Run disruptive probes only in isolated synthetic/local test environments. Bound concurrency, data size, retries, and cleanup to prevent runaway load or external side effects. Do not probe production, third-party systems, real-user records, send real messages, or make real purchases without explicit authorization. If an essential live check is unavailable, finish independent checks and identify the exact missing boundary and access/environment requirement. Never fabricate evidence or silently replace that boundary with mocks.

Keep evidence states distinct:

- **Reproduced/confirmed:** observed failure, with supporting reproduction or direct evidence.
- **Grounded but unverified:** a specific code or contract concern, with the missing confirming check stated.
- **Cleared:** the attempted scenario met its expectation in the tested conditions.
- **Untested:** a relevant path not exercised, with the reason.

Do not manufacture findings or provide a hypothetical vulnerability list. A clean run is not a correctness or security guarantee.

## Repair only within authorization, then finish

A standalone invocation reports findings without changing product code. During already-authorized implementation, return confirmed defects in requested behavior for scoped repair; repeat each failing scenario and affected normal verification after repair. Report unrelated pre-existing issues as follow-ups without fixing them.

Scratch checks need not be committed. Add permanent tests only when requested or when the repository already keeps this kind of test, matching neighboring tests and stated behaviors. Follow task-discipline rather than creating an always-test rule.

Stop after proportionate relevant scenarios and scoped rechecks, or concrete access/environment limits. Report findings by severity and impact with evidence and reproduction, then tested coverage, cleared cases, unverified concerns, and remaining gaps. Zero findings is valid; describe exactly what was tested.
