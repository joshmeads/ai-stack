# Working on uberdesigner studio

[← Back to the README](../README.md)

For people changing the skill itself: what is in the folder, the stacks, and the tests. How the server's modules fit
together is in [ARCHITECTURE.md](../ARCHITECTURE.md), how layers are found on the page is in
[Internals](internals.md), and how to send a change is in [CONTRIBUTING.md](../CONTRIBUTING.md).

## What's in the folder

```
uberdesigner-studio/
  SKILL.md                         the workflow Claude follows (index → read prompt → match → apply → verify)
  scripts/index.mjs                indexes the code: files, tokens, JSX elements, CSS variables per class
  scripts/read-prompt.mjs          splits a build prompt into sections (uberdesigner format v1, or any markdown)
  scripts/apply.mjs                tags parts with data-dm, installs the studio, writes inspector.map.json
  scripts/verify.mjs               checks the map against the project and typechecks
  reference/map-format.md          the map's format and what makes good parts
  reference/example.map.json       a complete map, of an invented site
  runtime/server/                  the studio's server side, copied into each project's .inspector/tool/server/:
    core.ts                        the way in, with the list of routes and of the modules beside it: api.ts (routes),
                                   queue.ts and jobs.ts (changes waiting and running), part.ts and project.ts (a
                                   change for Claude), claude.ts, prompts.ts, answer.ts, history.ts, threads.ts
                                   (undo, before/after), save.ts, css-write.ts, direct-changes.ts, motion.ts,
                                   settings.ts, map-store.ts, map-check.ts, estimates.ts, site.ts (the site's folder
                                   and files), access.ts. How they fit together: ARCHITECTURE.md
    slices.ts                      automatic context: which pieces of which files a change sends
    adapters.ts                    what differs per stack (checks, packages, how the panel attaches), and which
                                   stacks the setup scripts take on at all (stackSupport)
    address.ts                     where a layer is: its tag in the code (data-dm), or a selector asked of the page; the
                                   rule its own values are saved under (the scripts and the panel use it too)
    guard.ts                       who may call the API: only the studio's own pages, and changes only with the token
    values.ts                      the check every CSS value passes before it's written (the panel uses it too)
    vite-plugin.ts                 attach for Vite projects (the site's vite.config loads it if it's there)
    serve.ts                       attach for sites with no build step: sends the files, or stands in front of the
                                   site's own server
  runtime/panel-src/               the panel's source (React + TypeScript)
  runtime/panel/                   the panel built as one script and one stylesheet, copied to .inspector/tool/panel/
  package.json, panel.vite.config.ts   builds runtime/panel/ (pnpm build:panel); skill users don't need to
```

## Unsupported stacks

The setup scripts check the stack before they read or write anything. On a site they can't set up yet (Next.js, Astro,
Nuxt, SvelteKit, Remix, Vite without React, webpack…) `index.mjs`, `apply.mjs` and `verify.mjs` stop with "Not
supported yet: …" and the site is left exactly as it was. `apply.mjs` also writes nothing until every check on the map
has passed, so a mistake in a map can't leave a site half installed. `DESIGN_MAP_FORCE=1` skips the stack check, for
work on a new connector.

## Adding a stack

The core doesn't know the stack. A new one needs an entry in `runtime/server/adapters.ts` (how it's checked after a
change, whether it takes packages, how it starts), an attach (a plugin for its dev server like `vite-plugin.ts`, or the
standalone `serve.ts`), and in the scripts: what counts as source files (`scripts/lib.mjs`), how elements are found and
tagged (`index.mjs`, `apply.mjs`), and how `apply` wires it in.

## Before merging: what runs by itself

`.github/workflows/test.yml` runs on every pull request and on main: the type check of the panel and the server
(`pnpm typecheck`), the panel's build, the unit tests, and the browser tests of layer identity and of what the panel checks on the page. The sites suite below needs real test sites and is run by hand.

The tests never count into your own "Tokens Saved": every test that starts a server sets `DESIGN_MAP_TOTALS_DIR` to a
temporary folder (`tests/sites/cdp.mjs`, `tests/unit/api.test.mjs`), and `runtime/server/savings.ts` keeps its totals
there instead of in `~/.uberdesigner/design-map/`.

## Before merging: the unit tests

```
pnpm test        (node --test tests/unit/*.test.mjs)
```

A few seconds, no browser and no test sites needed: the value check, the API guard, where an answer's edits are
placed, how a stylesheet is written, which scripts are parsed and how, which stacks are supported, a layer's address and what `apply.mjs` writes for it (tags, selector targets, the
rename of older maps' tags), and an end-to-end run of the API on a tiny site built in a temporary folder (the
studio installed by `apply.mjs`, its own server started, a stand-in for Claude Code).

## Before merging: the browser tests

```
node tests/browser/identity.mjs        (needs Google Chrome; about 30 s)
node tests/browser/observe.mjs         (about 40 s)
```

`tests/unit/page-rules.test.mjs` covers how the page's rules are found in the files and what is sent for them.
`observe.mjs` covers what the panel checks on the page: with a scripted answer in Claude's place, a change that only
shows on phones, one that shows, one that adds a layer the page doesn't draw, and the notes on values that move nothing.
`identity.mjs` covers what only a browser can show about layers: a tiny site built in a temporary folder with every kind of layer (tagged, an element the
site itself tags `data-part`, a headline a script renders and renders again, a selector that matches nothing, a piece
with no element) and a second page with none of them. It checks the marks on the page, how fast a redrawn element is
marked again, what a click picks, a live and a saved value for a selector layer, and what the editor says about layers
the page doesn't carry. Run it after any change to `resolve.ts`, `address.ts` or how the panel looks layers up.

## Fixture sites

`tests/fixtures/` holds tiny sites kept in the repo, each built around situations real sites got wrong, so the checks
can run anywhere. The first is `veyl/` (its README says what each part of it is for): plain HTML with two stylesheets
where the later one wins on phones, colours as variables, a pinned section, an element that moves forever, a
phone-only element. The pages carry no tags; a copy is set up by `apply.mjs` of the version under test.

```
node tests/sites/run.mjs --sites tests/sites/sites.fixtures.json --base main --head .
node tests/browser/veyl.mjs [--skill <a checkout of another version>]
node tests/browser/presence.mjs [--skill <a checkout of another version>]
node tests/browser/cards.mjs
node tests/browser/objects.mjs
node tests/browser/narrow.mjs
node tests/browser/preview.mjs
node tests/browser/modes.mjs
node tests/browser/screens.mjs --out <folder> [--skill <checkout>] [--theme light|dark]
```

The second replays the problems the 15 Nov tester's report found (an invalid colour, a phone-only change the later
stylesheet resets, Undo after a change that added layers, slow searches) and prints what it saw, for any version of
the skill, so two versions can be put side by side. The third checks what the editor says about layers being on
screen, on the fixture's long story and its waiting title (cases from a 240,000 px story page a friend tested on 16
Nov): it passes or fails. The fourth walks a change through its life as a person would: its number on the card and on its pin over the page (and the pin's way to the card), Keep and the Resolved tab, Undo of the kept
change, Bring back, Bring back refused after the same lines were rewritten, History's points, and going back to one.
The fifth is the click rule, by clicks alone: nothing outlined at rest and one outline under the pointer; a click
picks the block (a heading inside a section, a card the map doesn't list), a section on its own space; a
double-click goes inside (the picture in a card) and a double-click on words picks that text and types; inside a
block single clicks pick at that level and a click outside is back at block level; Escape goes up; three cards that
are one layer are picked together and going inside reaches one; words over a canvas, the line of a pinned story
that shows now, a ball inside a never-outlined layer, and never a letter of a split title; rows for unlisted things,
a row outlining and picking its thing; Keep as layer; typing over words that aren't a layer; the nested-edits
scenario (a heading and a picture in one card, the card from the list, the heading typed over); and the selection
staying on its thing after the page reloads, at another size, after the editor reloads and when something is added
beside it. The sixth is the cover over an editor too narrow for its window: never in an ordinary browser, shown in
the Claude app's browser below the editor's width, gone when the window is widened or after Continue here anyway.

`preview.mjs` is the full preview: the site alone at the window's size with nothing of the editor over it, Escape back
to the same picked layer and size, a real click on the site's link opening its second page, the size menu, and Back
to editor on the page the site is on now.

`modes.mjs` is Focus and Design: a first visit lands in Focus (no layers list, no Elements), a click still picks and a
request runs there, switching to Design keeps the pick, the typed request and the size, the mode survives a reload,
and the logo's About card opens and closes without dropping the pick. The other browser tests open the editor in
Design (`openEditor` in `tests/sites/cdp.mjs` sets it unless told `{ mode: null }`), since they check the editor's
own parts.

`screens.mjs` is not a pass-or-fail test: it photographs 16 screens of the editor on a small two-page site it builds
(at rest, a section, a text and a picture picked, Assets, Pages, History, a finished change, the whole-site request,
Phone, Tablet, Preview, Focus, the About card, the site's own address arriving in the studio, Resolved), the same way every time, so a change to how the
studio looks can be put beside the version before it (`--skill` for that version, `--theme` for each theme).

## Before merging: the sites suite

`tests/sites/run.mjs` runs the same checks on the same test sites with two versions of the studio (by default
`main` and this working tree) and prints only what differs. Every change to the runtime or the scripts gets a run
before it merges. It exits 0 when the two versions behave the same, 1 when any check differs (a refactor must show
none; for a change that is meant to behave differently, read the lines and pass `--allow-differences`), and 2 when a
check couldn't run.

```
node tests/sites/run.mjs --sites tests/sites/sites.local.json [--only bakery,keycap] [--base main] [--head .]
```

- **layers:** every layer is picked from the list: does the editor show it, what does the footer say, is there a
  dashed "not shown" box, what does a click on it pick; the editor's and the site's frame rate; text editing.
- **writes:** idle (no file or map change), a saved value, a text edit and its Undo, a motion value, and Restore to
  the start, each compared byte for byte with a snapshot; layers, tokens and tunable values lost along the way.
- **size:** what three part changes would send to Claude.
- **coverage** (asked for with `--checks coverage`): the older count of how much of what a visitor sees can be
  picked, by one click or with ⌘. `tests/sites/picking.mjs` replaces it.

`tests/sites/picking.mjs` measures picking against the V1 goal on a site whose server is running
(`node tests/sites/picking.mjs <editor url> [name] [--json out.json]`, about five minutes a site, read-only). What is
on screen is decided from the page alone (tags, paint, size), never from the map or from the editor's own rule. For
each thing: is it reached by a click and then up to two double-clicks at the same point, or by its row in the list
(found the way a person would: click the block on the page, open its row, look under it); is the box under the
pointer what the click picks, and the same after a reload; does every outline, at rest and under the pointer, sit on
something that can be seen; is a section that is full on screen empty in the list; does the selection stay on its
thing after the page reloads, at another size and after the editor reloads; and the frame rate with the processor
slowed four times. It runs the same on any version, so two can be compared.

Each site is copied twice into a temporary folder (its `node_modules` linked, the studio's history left behind),
each copy is set up by that version's own `apply.mjs` with the site's map (so its tags are the ones that version
reads), and the copies' dev servers start with a stand-in Claude CLI, so nothing is ever sent to Claude and the sites themselves are
never touched. The sites file lists `{ "name", "dir" }` per site (`sites.example.json`; `sites.local.json` is ignored by
git). Needs Google Chrome (`CHROME=` for another path) and pnpm. Headless Chrome renders with the GPU; on a machine that
throttles to 30 fps (power saving), compare two runs made under the same conditions.
