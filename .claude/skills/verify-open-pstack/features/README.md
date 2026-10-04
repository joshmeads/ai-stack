# Maintained feature map

`registry.json` is the machine-readable ownership map. `core.ts` supports exact paths and terminal `/**` only. Unknown paths fail closed; rename classification includes both paths. Runtime markdown, references, playbooks, hooks, manifests, and scripts are runtime even when their extension looks documentary.

| Ownership | Required real surfaces |
| --- | --- |
| `skills` | One `skill-invocation:<name>` exercise per selected skill, in both harnesses |
| `shared` | All listed skills, setup, runner, and shipped tools in both harnesses |
| `assets` | Installed UI/resource surface for each actual consumer found in the pinned plugin manifests |
| `setup` | Installed setup/model configuration with byte-exact daily Claude file restoration before publication |
| `runner` | Installed parent invoking real configured provider lanes |
| `tools` | Installed parent invoking the changed shipped CLI |
| `project` | Native discovery/invocation of this verifier in both harnesses |
| `nonRuntime` | Explicit ordinary repository documentation, policy, non-shipped assets, and unit-test paths; no plugin harness launch |

Asset ownership is consumer-driven, not blanket shared ownership. Inspect the exact candidate's plugin manifests. At present, `plugins/pstack/assets/logo.png` is referenced only by `plugins/pstack/.codex-plugin/plugin.json`, so a logo-only change selects the installed Codex asset surface and does not invent a Claude exercise. New shipped assets must be added to `assets` and must have a real manifest consumer; missing, ambiguous, or unknown consumption fails closed.

`bootstrap.ts` belongs to `tools`; exercise its actual consumers, `orch` and `watch-pr`, including dependency bootstrapping rather than the unrelated external runner.

Skill-owned `SKILL.md`, `references/**`, and `playbooks/**` select their skill. Additional executable paths must be registered explicitly. Shared consumed mappings select every dependent skill conservatively. The coverage test inventories tracked plugin files; new unmapped files block CI and runs. Deleted skill surfaces cannot silently disappear from evidence: choose a surviving documented entry point demonstrating the intended removal, or report blocked.

The feature documents below define sub-features, user entry points, driving instructions, and gotchas. Review each changed sub-feature in the diff; one aggregate observation cannot replace distinct selected skills. Record all changed sub-feature actions in the feature's transcript and artifact. Do not run destructive application work in the maintainer checkout.

- `skill-invocation.md`: installed native skills, principle leaves, and project-skill self-test.
- `setup.md`: setup/routing/model configuration and byte-exact restoration.
- `isolation.md`: existing native logins, Codex auth symlink, and private run state.
- `runner.md`: parent-to-child provider dispatch and receipts.
- `shipped-tools.md`: orchestration, watch, plan checks, audit, and evidence logging.
- `assets.md`: manifest-declared installed assets on actual consuming harnesses.

Consumed `AGENTS.md`/`CLAUDE.md` instructions and `tests/skill-collision-repro.sh` select `project-skill`. `.mergify.yml` is explicitly `nonRuntime`. There are no blanket no-runtime exemptions for `.github/**`, `tests/**`, or `scripts/**`: unregistered instruction/enforcement paths fail closed until their ownership is reviewed and mapped.

Explicit non-runtime repository changes are `no runtime change`. Changes to this verifier always select `project-skill`; they cannot bypass native proof. `--self-test` also selects that exercise, deduplicated in each harness, and is mandatory for this skill's delivery PR. Plugin-runtime proof and local CLI proof remain separate.
