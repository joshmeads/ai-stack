# Plugins only for jm-stack; every other skill is standalone

jm-stack stays a plugin, because it ships hooks and agents and tracks upstream Open Pstack. Every other skill, including the former jm-games and jm-tools plugins, is a standalone skill: one folder in the stack's `skills/` directory, placed under its plain name into each harness's skill folder. Plugins can only be switched on or off whole and force a `plugin:` prefix. Standalone skills can be grouped and switched one at a time, which groups and per-project enabling need.

## Consequences

- Standalone names share one namespace per harness, so the stack refuses duplicates. A clashing upstream skill is renamed on the way in (`move`), for example `handoff` to `jm-handoff`.
- The `jm` marketplace drops to one plugin.
