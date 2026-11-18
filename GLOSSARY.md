# ai-stack

ai-stack keeps the owner's AI coding tools set up the same way on every machine they use, from one git repository.

## Language

### Where things come from

**Stack**:
The git repository that is the single source of truth for every skill, plugin, instruction and model setting ai-stack installs.
_Avoid_: library, source dir, config repo

**Skill**:
A folder with a `SKILL.md` that a harness loads on demand.

**Standalone skill**:
A skill delivered on its own under its plain name, which must be unique across the stack, rather than inside a plugin.
_Avoid_: linked skill, loose skill

**Plugin skill**:
A skill delivered inside a plugin and named with the plugin's prefix, such as `jm-stack:how`.

**Manual-only skill**:
A skill that runs only when called by name and is never picked by the model on its own.
_Avoid_: hidden skill, disabled skill

**Vendored skill**:
A skill copied into the stack from an upstream repository and pinned to the upstream commit it came from.
_Avoid_: imported skill, remote skill, dependency

**Stray skill**:
A skill in a harness's skill folders that the stack does not own.
_Avoid_: unmanaged skill, orphan

**Adopt**:
To bring a stray skill into the stack so that the stack owns it from then on.
_Avoid_: collect, import

**Group**:
A named set of skills that are turned on or off together, so a harness only sees the skills that matter for the work at hand.
_Avoid_: preset, profile, bundle

**Global group**:
A group that is on for every harness on every machine.
_Avoid_: default group, profile

**Project**:
A repository that turns on extra groups for work done inside it.
_Avoid_: workspace

### Where things go

**Harness**:
An AI coding tool that ai-stack installs into, such as Claude Code or Codex.
_Avoid_: agent, tool, target, client

**Provider**:
An AI command-line tool seen as an account to log into, for checking login status and logging in.
_Avoid_: harness (when talking about logins)

**Machine**:
One computer that ai-stack manages.
_Avoid_: host, node, device

**Fleet**:
All the machines the owner manages together.

**Publish**:
To commit the stack's changes, push them and update every machine in the fleet, from any machine.
_Avoid_: deploy, sync, push

### The hub

**Hub**:
The always-on machine that holds every subscription login and serves model traffic to the fleet over Tailscale.
_Avoid_: gateway, proxy box, server

**Fork**:
The owner's copy of CLIProxyAPI that the hub runs, which adds the hub's features and keeps merging upstream.
_Avoid_: patch set, proxy (when the owner's changes matter)

**Seam**:
An upstream file the fork changes, listed so that each merge knows where conflicts can appear.
_Avoid_: patch, hook

**Credential**:
One signed-in account or API key held by the hub.
_Avoid_: auth file, account (when talking about the hub's records)

**Access key**:
The key a machine sends to the hub, limited to a list of providers and revocable per machine.
_Avoid_: API key, token

**Hub home**:
A second harness home, such as `~/.claude-hub`, whose harness sends its traffic to the hub.
_Avoid_: profile, instance

**Pass-through**:
Traffic the hub forwards on the client's own login, reading usage without choosing a credential.
_Avoid_: tap, MITM

**Quota reader**:
The fork's code for one provider that reads a credential's usage windows from that provider.
_Avoid_: sidecar, adapter

**Ledger**:
The hub's stored history of every model request and response, with token counts, tool calls and quota readings, kept in the hub's local ClickHouse.
_Avoid_: logs, analytics
