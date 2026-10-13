# jm-games

Game and graphics skills for Claude Code and Codex, shipped in the `jm` marketplace.

| Skill | Use |
| --- | --- |
| `threejs` | Version-specific facts for three.js r180+ (WebGPURenderer, TSL, RenderPipeline, WebGL2 fallback) and react-three-fiber v9. |
| `art-iteration` | Iterate a visual deliverable against reference images until an image-only critic passes it. |

The `art-iteration` critic runs on the review model named in the routing block of your global instructions (Claude Code: Opus 5.5 xhigh; Codex: Sol 6.1 xhigh). The final critique also asks the other provider through its CLI.

## Install

The ai-stack CLI installs this plugin from the local `jm` marketplace. To install it by hand:

```sh
# Claude Code
/plugin marketplace add joshmeads/ai-stack
/plugin install jm-games@jm
# Codex
codex plugin marketplace add joshmeads/ai-stack
codex plugin add jm-games@jm
```

License: MIT.
