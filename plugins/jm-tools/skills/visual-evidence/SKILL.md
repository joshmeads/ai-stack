---
name: visual-evidence
description: Show a UI change with screenshots taken under the same conditions before and after. Use for visible bugs, layout, spacing, color, typography, theme or responsive changes, new components, or when asked to show what changed. For art or VFX judged against a reference, use `art-iteration` (jm-games) instead.
---

# Visual evidence

A claim about how a screen looks needs a picture of it. The before state is gone once the code changes, so take it first.

## When

- The change alters something that already renders: take a before and an after.
- New UI with nothing to compare against: take an after only.
- No rendered output: skip this skill.

## Steps

1. Before editing, open the app in a tool you already have (the Claude Code browser pane, Codex's built-in browser, the iOS Simulator, or the app itself) and bring it to the state that shows the problem.
2. Screenshot the affected element or region with just enough surroundings to locate it. Note what it takes to reproduce the shot: route or screen, data, viewport size, theme, and any hover, open or focused state.
3. Make the change.
4. Recreate the same conditions and take the after shot with the same framing. Add another viewport or theme only when the change affects it.
5. Open both images and zoom in. Check that they show the intended state, match in framing, and show the change you are claiming. Retake them if not.
6. Report the image paths and the conditions. When the change goes to review, include the pair.

## Limits

- Save screenshots outside version control. Do not commit, upload or attach them to a pull request or issue unless the user asks.
- Before sharing an image, check it for secrets, personal or customer data, private URLs, and unrelated windows or notifications.
- If the before state is already gone, say so. Do not stash, switch branches or restart a running app to recover it without asking.
