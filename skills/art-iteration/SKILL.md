---
name: art-iteration
description: Iterate a visual or art deliverable (VFX, shaders, materials, illustration, motion, UI look) until it meets a reference bar. Use when the work is judged by how it looks, when the user supplies reference images, or when a visual review fails.
---

# Art iteration

The reference bar is the deliverable. Infrastructure, schemas, types, tests and documents do not count toward it.

## Before code

1. Pick one reference per item. Write a target of five lines or fewer: dominant shape, value tiers (hot core, saturated mid, darker edge), hue over time, timing, and what makes it read at small size.
2. Choose the technique that builds that shape: geometry, masks, ramps, textures or particles. Glow and bloom never form the shape. Bloom only finishes a shape that already reads without it.

## Loop

Work on one item at a time.

1. Render the fast view: one camera, the peak frame plus two other moments, composited side by side with the reference into one image. Use any available tool (ImageMagick, sharp, a Playwright page).
2. Open the composite, then crop and zoom into the effect before judging it.
3. Send the reference and the composite to the critic (see "Critic"). Act on its three gaps.
4. Change the pixels every round. A round that only changes code structure, types, tests or docs does not count as a round.
5. Repeat until the critic passes the item. After three rounds without visible improvement, switch technique, for example from shader glow to modelled geometry. Do not stop.
6. Move to the next item only after this one passes. Depth before breadth.

Keep every round's composite. End with one final composite of all items beside their references.

## Critic

The critic sees only the reference images and the composite. It does not see source code, design notes or the author's reasoning, so it judges pixels, not effort.

- Every round: spawn a read-only subagent on the review model named in the routing block of your global instructions (Claude Code: Opus 5.5 at xhigh; Codex: Sol 6.1 at xhigh). Give it only the image paths and the critic prompt below.
- Final critique before calling the look done: also get the other provider's verdict through its CLI. Copy the reference and the composite into the working directory, and write the critic prompt to a prompt file.
  - Claude lead: `codex exec --skip-git-repo-check --disable multi_agent -s read-only -m gpt-6.1-sol -c model_reasoning_effort=xhigh -i <reference> -i <composite> -o <report> - < <prompt file>`
  - Codex lead: `claude -p --model claude-opus-5-5 --effort xhigh --permission-mode dontAsk --disallowedTools Edit,Write,NotebookEdit,Agent,Task < <prompt file> > <report>`. `claude -p` takes no image flag, so name the copied image files in the prompt file, reference first, and ask the critic to read them.

  The command may need the user's approval. If it is refused or cannot run, report the final critique as single-provider. The look is done when both critics pass it, or when the single available critic passes it and the report says so.

Critic prompt:

```text
You are a visual critic. The first image is the reference bar. The second is a render composite.
Judge only the pixels. Return:
1. Verdict: pass or fail against the reference.
2. The three largest visual gaps, worst first, each described as something visible
   (for example "flat single-hue glow, no hot core").
3. For each gap, one concrete visual change likely to close it.
No praise, no process commentary, no scoring of effort.
```

## Rules

- A failing visual review is the next task, never a blocker. "Blocked" means missing access or a decision only the owner can make.
- Run the full evidence package (all cameras, grayscale and silhouette checks, video, backend parity) once per item, after the critic passes it, not every round.
- Engineering requirements (editor support, schemas, APIs) constrain how you build. They are not progress toward the look. Add them after the look works, or earlier only when the look cannot work without them.
- When a goal combines a look with an architecture, the look is the gate and the architecture is a constraint.
- Report progress as composites. Do not claim an item passes without a critic pass on a current render.
