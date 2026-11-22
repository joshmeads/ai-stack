# Measurements

[← Back to the README](../README.md)

What setting a site up costs, what Claude Code builds by default, and the sites the studio was tested on. How the
token savings are measured has its own page: [How we measure the savings](methodology.md).

## When to set it up

The cheapest moment is **right after Claude builds the site from its prompt, in the same conversation**: the skill's
description has Claude offer the studio in its build hand-over, and its short path ("Right after a build" in
SKILL.md) writes the map from what Claude already has in context. It indexes the code once, writes the map, then
applies and verifies, in about four tool calls. Any other time (a site built elsewhere or earlier) takes the full steps.

Measured 2026-11-13, in input-equivalent tokens (cache reads at 0.1×, cache writes at 1.25×, output at 5×):

| | Setup cost |
|---|---|
| Full steps, moorline-stillwind (a fresh agent, 28 turns) | 586k |
| Short path, moorline-strandwell (same template family; the agent first read the prompt and all the code, as a builder would have them) | 242k, then **214k** after the index started listing the prompt's section paths and the skill gave the map's shape inline |
| **Real build**, easylog-rime (24 KB prompt): an agent built the site from the prompt (467k), offered the studio on its own in its hand-over, and on "yes" set it up in 5 turns | **182k** (full steps on its sibling easylog-ember: 529k) |
| **Default build**, a coffee shop from "build me a website for my coffee shop" (no prompt file): Claude Code made one Artifact page (100k), offered the studio on its own, and on "yes" copied the page to a folder, mapped 19 parts from the code and passed verify in 7 turns | **141k** |

For comparison, building a site from a prompt took 1.0–1.2M (a hero section, a personal site) and a set of template
versions 1–3.3M, from the session logs. Setting up right after a build adds about 40% to a small build like rime's (a 24 KB prompt)
and less to bigger ones, and pays for itself within the first few changes. On rime the outlines were checked in the
browser: every part on screen framed what its label names.

## What Claude Code builds when asked for "a website"

Measured 2026-11-13 with Claude Code 2.1.323 and its default settings, eight plain requests ("build me a website for
my coffee shop", a photographer's portfolio, a yoga studio with booking, a wedding with an RSVP form…), each run twice:

| Where it ran | What it built |
|---|---|
| An empty folder, claude.ai Artifacts on | 8 of 8: one HTML page with its CSS and JS inside, named after the site (`coffee-shop.html`), written to Claude's temporary folder and published as a claude.ai Artifact. Pages with bookings or RSVPs keep them in the Artifact's own database (`window.claude`). |
| A git project folder, Artifacts off | 7 of 8: `index.html` plus `styles.css` and `script.js`. 1 of 8 (the RSVP): a zero-dependency `server.js` that saves replies, with the pages in `public/`. |

None of the 16 used React, Tailwind or a build tool, and every one styled the page with plain CSS variables on
`:root`, which is the token model the studio reads. So the plain HTML stack covers all four shapes:
- **any page name**: `/` is the site's first page (`index.html`, else the one page at the top, else the biggest), also
  when the pages are in `public/`, `static/` or `www/`;
- **an Artifact page**: the skill copies it from Claude's temporary folder into a real one and records its link
  (`source.artifact`), so asking Claude to publish it again updates the same link. The page is sent with the doctype and
  `<head>` claude.ai adds when publishing, and with a stand-in `window.claude` whose `use()` answers null ("not
  available here"), the case every Artifact page handles, so it draws in full;
- **a site with its own server**: `serve.ts` starts it on a free port (as `PORT`; a server that prints another
  address is followed there), stands in front of it adding the panel to its HTML, and restarts it when its code
  changes. Its forms and routes keep working; the data files it writes don't ask for a reload;
- **several files**: an edit to `styles.css` swaps the stylesheet live.

On that coffee shop site, real changes through the studio took 5–6 s and sent 2.3–2.6k tokens on Haiku
and the open page updated live. Its headline is a bare `<h1>` styled as `.hero h1`; automatic
context now also matches a classless element's own tag and id, so the change edited that rule in place instead of
adding an override.

Typing over text, tested 2026-11-13: on the coffee shop, "USD" to "EUR" in the menu note went straight into
`coffee-shop.html` (and back again); the opening status, which the page's script writes, went to Claude, who changed
the script's label in 3 s; Escape put a typed word back. On easylog-rime (React, words in `src/content.ts`, headline
split into letters), the box over the headline sent "kept whole." to "kept intact." to Claude, who changed
`content.ts` in 2.8 s on Haiku, and the page hot-reloaded without a crash. The finder itself was checked on 13 cases
across three test sites (direct swaps in HTML, in a React words module and in a string array; phone copies,
script-made words and quotes sent to Claude).

## Tested on

Seven projects, five of them mapped by fresh agents following SKILL.md as written (2026-11-13), then re-checked with
the fixed scripts. All seven: verify 0 errors, typecheck passes.

| Project | Kind | Parts (outlined) | What it exercised |
|---|---|---|---|
| umbrela-hero (lacrima-foresta) | section + three.js sphere | 15 (11) | live word fields |
| lucid-hush | two screens | 13 (12) | words in a TS module; brand colours set from code |
| easylog-ember | section, cursor-driven WebGL | 12 (9) | hidden probe elements; custom cursor |
| lamplit-sunlit | 3D book site | 13 (6) | no Layout sections; 141 KB code section; 3 `:root` blocks; objects only in WebGL |
| moorline-stillwind | particle scene | 16 (13) | headings built by a component; `display: contents`; 25k-char motion block |
| keycap-sphere-ludica | 3D game-like site | 19 (11) | 263 KB prompt; TypeScript 7 (`DESIGN_MAP_TS`); `<Canvas>` with `forwards`; look tokens set from code; a site that hides the cursor with `!important` and doesn't reset buttons |
| portale-luna, **code-only** | scroll fly-through | 22 (18) | mapping with no prompt (~2× the index in extra reading) |

Checked on the page (every outlined part present with a real box): umbrela-hero, lucid-hush, keycap-sphere-ludica,
moorline-stillwind. Not yet tried: UI-widget loops, app screens, games and phone UIs from the other galleries, whose
prompts may be shaped differently.

Plain HTML (no build step), 2026-11-13: the **coffee shop** Claude Code built from "build me a website for my coffee
shop" (one Artifact page, 19 parts, mapped from the code alone): verify clean, every part tagged on the page, real
changes sent 2.3–2.6k tokens and took 5–6 s. Restore works the same as on Vite projects. The wedding site with its own
server and an Artifact RSVP page were checked in the browser too (see "What Claude Code builds when asked for a
website").

What verify reports as a part's typical request size after slicing (median / largest, thousands of tokens of code):
umbrela-hero 2.7 / 5.4, lucid-hush 2.3 / 4.0, keycap 4.4 / 7.3, moorline 2.2 / 5.5, easylog 3.7 / 3.9, lamplit 2.3 /
22.9 (3D objects whose scene is one large component), portale-luna 3.0 / 9.5, coffee shop 0.4 / 1.6.

Known limits: objects drawn inside a canvas can be changed but not clicked (`outline: false`); layers that stay in the
page while hidden outline at every scroll position; a part defined inside one very large function (a whole 3D scene
component) still sends that function whole (verify warns above about 8k tokens).
