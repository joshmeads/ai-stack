---
name: gdd
description: Write a game design document (GDD.md) for a new game, plus the AGENTS.md and Codex agent files the build will follow; or a short mini-GDD design brief. Interview the user until every open question is answered or they tell you to use your judgement. Use for "write a GDD", "game design doc", "mini-GDD", "design brief", "/gdd", "plan a new game", or before starting any new game build.
---

# GDD

This skill produces the documents a game build runs on. It does not build the game.

Outputs, all in the game's repository root:

| File | Source |
| --- | --- |
| `GDD.md` | Written from the interview, using `references/gdd-template.md`. |
| `AGENTS.md` | `references/agents-template.md`, with the project section filled in. |
| `.codex/agents/implementer.toml`, `.codex/agents/qa.toml` | Copied from `references/codex-agents/`. |
| `refs/` | Reference images the user supplied or approved. |

**Format.** Use the full format above by default. Use the short format, `references/mini-gdd-template.md`, when the user asks for a mini-GDD or a one-page design brief, or wants a document for another reader rather than for a build. The short format writes `GDD.md` only, unless the user also asks for the build files. If the user supplies their own GDD template, follow its headings and order, and fill each heading with the same concrete content the rules below require.

Before acting, read and follow `~/.local/share/open-pstack/skills/task-discipline/SKILL.md`. This skill overrides it in two places:

- **Questions.** A GDD interview is the case where asking is the job.
- **Models.** The user set these models for Codex game builds on 2026-10-09:
  - orchestrator: `gpt-6.1-sol` or `gpt-6-astra`, high;
  - implementers: `gpt-6.1-sol`, high;
  - QA and reviews: `gpt-6-astra`, high.

  They replace task-discipline's model table for this skill and for the files it writes. Copy the models in the templates unchanged unless the user names different ones in the interview. Do not apply task-discipline's Opus or fallback rows.

## Why the rules look like this

Earlier Codex-built games (Driftwood, Soar, Shardfall, Blackwater, Low Altitude, Sep–Oct 2026) failed in repeatable ways, and the user rejected them:

- **The model ticked its own acceptance boxes over obvious defects.** For example, a river mesh that never rendered.
- **It hid problems by shrinking features.** River bends were scaled to 5% to avoid terrain overlap.
- **It replaced named specs with "inspired" versions.** "BattleTech rules" became an original simplified ruleset.
- **It left core mechanics fake.** A tow line did not pull on the boat.
- **It left code unwired or uncommitted.**
- **It spent whole sessions on measurement tooling instead of visible fixes.**
- **It stopped early.**

Many of these trace back to vague GDD wording: adjectives instead of numbers, art restricted to code-generated primitives, and long plans that put tooling first. A GDD that is concrete and testable prevents most of them. The AGENTS.md template carries the build-time rules.

## 1. Gather context

1. Read the user's request and every file or image they point to. If the game comes from a written brief or prompt, copy each explicit requirement into the GDD's **Brief requirements** list in the brief's own words. These are fixed; questions may refine them but never replace them.
2. Inspect the target folder:
   - Is there git?
   - Is there an existing GDD, AGENTS.md or code?
   - Do sibling projects set conventions to carry over (package manager, renderer, ports, remote)?
3. Walk every section of `references/gdd-template.md` and every area in `references/question-bank.md`. Wherever you would have to guess, add an entry to an **open-question list**. Do not guess silently.
4. If the user gave no reference images for the look, offer to generate 2–4 concept images with Codex's built-in `image_gen` tool (the `imagegen` skill). Let the user pick or reject them during the interview. Approved images go in `refs/`.

## 2. Grill the user

Keep asking until the open-question list is empty, or until the user tells you to use your judgement, either for everything or for a named area.

- **Rounds.** Ask 5–10 numbered questions per round, grouped by GDD section. Give each question your recommended answer and a one-line reason, so the user can reply "1 yes, 2 b, rest default".
- **Order.** Ask first about whatever changes the core loop or the architecture: genre, core mechanic, rules, camera, platform and stack. Then feel, art and audio, then scope tiers, then details.
- **How to ask.** Use the `request_user_input` tool if the session has it. Otherwise ask in a normal message and end your turn. Never answer your own questions. Do not start writing the GDD while any question is open.
- **Vague answers get a follow-up.** For example, "make it feel good" becomes: which reference game, what turn rate or acceleration, floaty or snappy? "Make it look AAA" becomes: which reference images, and what would make it look bad?
- **Restate interpretations.** Say how you read any non-literal answer, so the user can correct it.
- **Point out contradictions** between answers, and ask which one wins.
- **Named things are taken literally.** For a named ruleset, edition, reference game or technique, confirm the exact source and whether the user wants faithful or loose ("BattleTech Total Warfare rules, exactly" or "inspired by").
- **When the user says to use your judgement,** decide. Record each such decision in the GDD's **Assumptions** section with the choice and a one-line reason, so the user can scan and override them later.
- **Final round.** List every decision you made on your own, then ask once whether anything is wrong or missing. Write the files only after that answer, or after "go".

If no user can answer (non-interactive run), write the GDD with every guess marked in **Assumptions**. Still give the build a visual target: generate 2–4 concept frames with `image_gen` at gameplay cameras, save them in `refs/`, and label them "self-selected, not user-approved" in **References**. List the unanswered questions in `JOSH.md`, and say so in your final message.

## 3. Write GDD.md

Follow `references/gdd-template.md`. These rules apply to every line:

- **Concrete and testable.** Use numbers with units and limits: "max 2 player shots on screen", "turn rate 90°/s, ease-in 0.25 s", "1920×1080 at 60 FPS on an RTX 5080, p99 frame ≤ 20 ms". An adjective needs a measure or a reference image.
- **Acceptance describes what a player sees or does.** For example: "the log stays fully in frame on every bend and during free look", or "rocks rest on the ground: no gap or overlap visible at gameplay cameras".
- **Quality bar.** Write it as reference images plus a defect list, not as adjectives. The list holds the things that would make the user call the game bad.
- **Derived numbers agree.** Before finishing, compute what the stated numbers imply and check it against the stated targets: level length ÷ speed gives level duration, levels × duration gives run length, spawn rate × duration gives counts, and the score ceiling follows from the scoring rules. Fix any mismatch in the GDD. *(One GDD set 2,560–3,840 px levels at 180 px/s against a 3–5 minute run target; the built campaign lasted under a minute.)*
- **Hardware-only checks never gate a tier.** Acceptance that needs hardware or software that may be absent (a physical gamepad, a specific GPU, a browser that is not installed) is written as "verify if available; otherwise report as unverified". The game behaviour itself still gates the tier.
- **Scope in tiers.** Tier 1 is the smallest complete, playable game in the real art direction, not a grey-box prototype. The look work (assets, variants, lighting, palette) is part of tier 1 as its own items, not polish deferred to a later tier. Each tier lists its features with acceptance. Add the rules "Never break a lower tier to work on a higher one" and "Unfinished features are hidden behind flags, not left broken". Write an explicit **Out of scope** list.
- **Core mechanic first.** Describe the core mechanic's physical or rules behaviour exactly, for example "the tow line applies equal and opposite impulses to boat and capsule".
- **Assets.** Unless the user restricted them, the GDD allows these without asking:
  - CC0 asset libraries (Poly Haven, ambientCG, Kenney, CC0 OpenGameArt);
  - headless Blender scripts;
  - generated artwork from the `image_gen` tool.

  Each asset needs a one-line source and licence entry in `ASSETS.md`. Prefer real assets to primitive procedural shapes whenever the quality bar is high.
- **No unrequested content.** No flavour text, taglines, extra screens, features or mechanics that the user did not ask for. If a template item does not apply (no health, no pick-ups), say so in one line instead of inventing a system.
- **Brief requirements are traced.** When the game comes from a brief, every requirement in **Brief requirements** points to the section or tier item that satisfies it, and nothing in the GDD contradicts one.
- **Closed loops.** Every action has a control and every control has an action. Every changing player attribute is visible on the HUD or shown another way. Every menu option leads somewhere that exists. The core loop ends in a way to restart or replay.
- **Real references only.** Every reference has a heading that says what it is for. Use images and links the user supplied, approved `image_gen` images, or pages you opened yourself. Never invent a URL or describe an image you have not seen.
- **Length.** As short as completeness allows; aim for at most 400 lines. The GDD contains no implementation plan. The orchestrator writes `PLAN.md` (at most 200 lines) at build time.
- **Prose.** Plain, imperative, short sentences. No marketing tone. Keep terminology stable.

## 4. Write AGENTS.md and the agent files

1. Copy `references/agents-template.md` into `AGENTS.md`. If an `AGENTS.md` already exists, merge: keep the user's existing rules, add the missing sections, and point out any conflict.
2. Fill in the **Project** section: stack, commands, dev ports, remote, deploy target.
3. Copy `references/codex-agents/implementer.toml` and `qa.toml` into `.codex/agents/`. If the user chose different models or effort, change them there and in `AGENTS.md`.

## 5. Save

1. If the folder has no git repository, run `git init -b main`.
2. Add a `.gitignore` covering `node_modules/`, `dist/`, `.worktrees/`, `qa/` and working capture folders.
3. Put reference images in `refs/`.
4. Commit `GDD.md`, `AGENTS.md`, `.codex/agents/`, `refs/` and `.gitignore` on `main` with the message `docs: add GDD and agent rules`. Use the user's configured git identity. If git reports none, ask the user for it; do not invent one.
5. If the user gave a remote, add it and push `main`, then confirm with `git ls-remote`.

## 6. Report

Tell the user:

- the paths written;
- the commit;
- the number of assumptions, with their headings;
- any questions left in `JOSH.md`.

Then give the launch prompt for the build, filled in:

```text
Read AGENTS.md and GDD.md in <path>. You are the orchestrator (<model>, high).
Write PLAN.md, then build tier 1, then tier 2, then tier 3, following AGENTS.md.
Run until every tier passes QA or a real blocker stops you; put blockers in JOSH.md.
```

Do not add a clause telling the build to stop when its budget is nearly used. A clause like that gave an earlier run a reason to stop with half its context unused.
