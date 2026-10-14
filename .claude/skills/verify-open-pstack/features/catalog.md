# Model catalog

## Sub-features

The generated model catalog (`plugins/pstack/skills/poteto-mode/references/model-catalog.md`), the generated Claude-native `pstack-<family>-<effort>` agents, and the runner registry sources they come from (`scripts/runner/registry/**`, `scripts/runner/providers/**`): model matrix, kept predecessors and rolling aliases, routes, provider notes, and role defaults.

## How to get to it (user POV)

A parent reads the catalog through `provider-dispatch.md` whenever a configured role launches. Invoke the installed `poteto-mode` skill and ask it to resolve roles from a model sheet.

## Driving it with verify-open-pstack

Give the parent a fixture model sheet, not the operator's configured one, so this feature changes no real configuration. Ask it to report each role's descriptors and routes as JSON. Compute the expected role defaults and routes from the installed candidate's catalog and the fixture sheet, never from a copy in the verifier.

## Gotchas

The outcome is the evidence: the reported descriptors and routes must equal the candidate's. Do not check which files the parent read or the text of its commands. A catalog change also selects `setup` and `runner`, because setup reads the catalog and the runner resolves lanes through the registry.

## Headless

The catalog recipe in `recipes.ts` writes a fixture sheet whose `judgment and prose` line takes another role's default descriptor, so only a read of the sheet reports it. The sheet has no `arena runners` or `bug-fix` line. It puts `swarm workers` on `codex:gpt-6-luna@max`, `hardest tasks` on the registered pin `claude:claude-opus-5-5@max`, and `how explainer` on the versioned `claude:claude-sonnet-5-5@high`. The parent writes `routes.json` with the descriptors and routes of those six roles. The case asserts the `poteto-mode` load and that the report equals, role by role, the sheet's descriptor or the installed catalog's role default, each with the route the catalog's route table gives this parent. The pin and Luna stay unchanged and the Sonnet revision is reported as `claude:sonnet@high`. The recipe fixes those dispatched descriptors, and the catalog gives their routes.
