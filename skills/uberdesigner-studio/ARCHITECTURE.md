# How uberdesigner studio is built

One page for someone about to change the code: the pieces, how a change travels through them, and the rules the code
keeps. The longer account of how a layer is found on the page, picked and brought on screen is in
[docs/internals.md](docs/internals.md); the folder and every test are in [docs/development.md](docs/development.md);
how to send a change is in [CONTRIBUTING.md](CONTRIBUTING.md). What the product does and how to use it is in
[README.md](README.md) and [docs/](docs/); how the skill sets a site up is in [SKILL.md](SKILL.md).

## The four pieces

| Piece | Where | What it does |
|---|---|---|
| Setup scripts | `scripts/` | Run by Claude Code while setting a site up, no tokens spent: index the code, read the build prompt, **apply** a map (tag the layers, install the tool, write `inspector.map.json`), **verify** it |
| Server | `runtime/server/` | Runs inside the site's dev server on the person's machine: the `/__inspector` API, Claude Code runs, history, every write to the site's files |
| Panel | `runtime/panel-src/` (built into `runtime/panel/`) | The editor in the browser: the site in a frame, its layers, their values, the chat |
| Connector | `adapters.ts`, `vite-plugin.ts`, `serve.ts` | What differs per stack: how the server attaches to the dev server, how a change is checked, whether packages can be added |

`apply.mjs` copies `runtime/server/` and `runtime/panel/` into the site's `.inspector/tool/`, and the site runs them
from there. Nothing of the studio is in a production build except the `data-dm` attributes on the layers and the
rules saved for single layers.

## How a change travels

1. **The panel** asks the page which element is which layer (`resolve.ts`, the only place that does), shows the
   layer's values, and sends a request to the API with the site's token.
2. **`api.ts`** checks who is calling (`access.ts`, `guard.ts`) and hands the request to the module that does the work.
3. **A value saved in the panel** (`save.ts`): every value is checked (`values.ts`), the new stylesheet text is worked
   out in full (`css-write.ts`), then written once.
4. **A change for Claude** becomes a job in the queue (`queue.ts`, `jobs.ts`). For one part (`part.ts`): the panel
   sends along the CSS rules the page applies to the part (`pageRules.ts`), the pieces of code that belong to the part
   are picked (`slices.ts`: those rules found in the files, markup, script functions), Claude Code is called once with no tools (`claude.ts`,
   `prompts.ts`) and answers with find/replace edits, which are placed (`answer.ts`), checked (typecheck or script
   parse), and recorded. For the whole site (`project.ts`): Claude Code works as an agent in the project.
5. **After any write** the map is brought in step with the code (`map-store.ts`, `reconcile.ts`) and a version is
   recorded in the private git history (`history.ts`). Undo, before/after and "use this one" work on those versions
   (`threads.ts`).

## Rules the code keeps

These hold today, and a change must not break them:

- **One writer at a time.** Everything that writes the site's files runs inside `withWriteLock` (`history.ts`).
- **Record before writing.** Edits made outside the studio are recorded as a version before the studio writes
  (`recordOutside`), so History can always go back to what was there.
- **Nothing is written half.** A save or an answer is checked and worked out in full first; one bad value or one edit
  that doesn't fit stops all of it. `apply.mjs` writes nothing until every check on the map has passed.
- **Only the studio's own pages may call the API**, and a change needs the site's token (`guard.ts`).
- **No big file leaves unasked.** A request that would pass about 20k tokens because Claude asked for a whole file
  waits for the person's OK (`part.ts`).
- **One place asks the page for a layer** (`resolve.ts`), and one file says what an address is (`address.ts`).
- **The studio says when it doesn't know.** A layer the page doesn't carry is marked so, with the reason; a value
  for it isn't offered and isn't saved.
- **The page is asked, not guessed, and only sure things are said.** What a change did is read from the page
  (`observe.ts`), and a note about the page ("nothing looks different", "no rule uses this value") appears only when
  the page proves it. What can't be seen (hover, motion, a canvas) is named as not checked.
- **The editor holds the map as it is now, and the page decides the tree** (`parts.ts`, `tree.ts`). The map is
  swapped in place when it changes on the server; no module keeps a table built from it at import. Which layer sits
  in which, and in what order, is read from the page for every layer it carries; the map's `parent` and order are
  the fallback for what the page can't say. Nothing is stored that the page can tell.
- **The page is the source of what can be picked; the map names it** (`objects.ts`, `tree.ts`, `Outlines.tsx`,
  `layers.ts`, `html-tree.ts`). One rule says what a thing is (a layer, a block of words, a link or button, a
  picture, video or drawing, a box with a look of its own), and the running page is read as a tree with it:
  sections, blocks, parts. A click picks the block under the pointer, a double-click goes inside, a double-click on
  words types, Escape goes up; the list is the same tree, a row for every thing, read when a row is open. The
  outline under the pointer and the click ask the same function, so they can't disagree. Nothing is outlined at
  rest, and only what is drawn is measured each frame. Picking writes nothing: a thing the map doesn't list becomes
  a layer on its first change, tagged in the source only where the element is found there for certain (place, tag,
  classes, words all agree), else kept by its address. Nothing is tagged by guess. The picked thing is followed by
  its element, not only by its address, so it is still the picked thing after the page changes around it.
- **What the studio writes on purpose is shown, and the page reloads only at a click.** A stylesheet shows at
  once. Code written by a finished request, an undo, a try, a comparison or a restore marks the page as needing a
  reload wherever the dev server only swaps modules in (`site.ts` `wroteOnPurpose`, the adapter's `hotUpdates`): a
  hot update is reported as done even when code already running keeps its old values. After a request the panel
  shows a bar with a Reload page button (`ReloadBar.tsx`); the editor's own actions reload at their click
  (`jobs.ts`). Every such reload returns to the same scroll position (`site.ts` `reloadInPlace`). `serve.ts` judges
  its own pages file by file.
- **One place says whether a layer is on screen, and one search brings it there** (`presence.ts`). "Shown" is read
  from what is on screen now; where each layer shows is noted while the page scrolls and tried first next time; a
  search has a budget, one state the row and the footer both read, and it puts the page back when it finds nothing.
- **One record of what is in the page** (`history.ts`). Every version carries the list of changes the page holds at
  that version, written once and never edited. Card state, the "changed" marks and History's own marks are read from
  the newest version's list; nothing keeps an "undone" flag beside it, so cards and History cannot disagree. History
  shows points (marks on versions worth going back to); every write is still a version underneath.
- **A direct edit is silent and never spends tokens by itself** (`direct-changes.ts`, `directEdit.ts`). Written
  words, links, pictures and numbers make a History version and no card; what can't be written safely is said, and
  goes to Claude only when the person presses Ask Claude.
- **Importing does nothing.** No module acts when it is imported; the dev server calls `start()` (`core.ts`) once.
  The setup scripts rely on this to use server functions on any folder.
- **Pure text helpers stay pure.** `address.ts`, `values.ts`, `guard.ts`, `slices.ts`, `reconcile.ts`, `text.ts`,
  `css-write.ts` and `script-check.ts` import nothing from Node, so the panel and the scripts use the same code the
  server does, and they are tested without a server (`tests/unit/`).
- **The site's own state stays out of the site.** History, cards, settings and work files live in `.inspector/`,
  which is ignored by git.

## Not true yet

Known gaps, each with the planned step that closes it:

- **The result is only partly looked at.** After a Claude change the panel says when the part looks no different, and
  the server checks the CSS still closes. Not yet: words a script or a CMS overwrites after a typed edit, a link or
  image that isn't really in the files, an element added inside a heading (the rest of step 3).
- **Script context is picked from text.** Which CSS rules belong to a part is asked of the page (`pageRules.ts`,
  `slices.ts` rulesFromPage); which script code does is still matched by names in the source (step 6).
- **The map is partly a stored copy** of what the code could tell (order, nesting, which tokens a layer shows), kept
  in step by rules that can drift (step 5).
- **Shared state is module-level.** `site.ts`, `jobs.ts`, `history.ts`, `threads.ts` and `map-store.ts` each hold
  variables the other modules read. One site per process is assumed.
- **The stack still shows through.** Both system prompts and a few paths name Vite + React, and adding a stack means
  editing several files (step 7).

## Tests

- `pnpm typecheck`: the panel and the server code. The server check allows only syntax Node can strip (Node runs the
  `.ts` files as they are) and requires a type to be imported as a type.
- `pnpm test`: unit tests of the pure helpers, of what `apply.mjs` writes, and of the API end to end on a tiny site.
- `node tests/browser/identity.mjs` and `observe.mjs`: layer identity, and what the panel checks on the page, in a
  real browser.
- `node tests/sites/run.mjs`: the same actions on test sites with two versions of the studio; exits 1 on any
  difference. A refactor must show none. `tests/fixtures/` has sites kept in the repo for it.
