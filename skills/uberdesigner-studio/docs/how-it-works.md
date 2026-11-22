# How it works

[← Back to the README](../README.md)

What happens under the editor, for someone who wants to know before trusting it: setup, what a change sends to
Claude, who can call the studio, what it may write, and what it checks. How a layer is found on the page is in
[Internals](internals.md), for people changing the code.

## Setup, and updating a project

The site's address opens in the studio: the server sends a browser that asks for a page of the site to the editor
on that page (it tells a person's page load from the editor's own frame, a file or a script by what the browser says
it is loading; `?studio=off` switches this off for a browser). The
editor and the site share the same dev server and origin, so the editor reads, outlines and live-edits the framed
page directly.
The studio's changes run Claude Code on the person's computer, on their own Claude plan. The desktop app and IDEs
keep their own copy, which doesn't count. So setup starts there, in the chat (SKILL.md step 0): Claude explains that the studio uses their own Claude account
through the terminal, and the person runs the command themselves (install, then `claude auth login`, which opens
claude.ai in their browser). Node.js comes next, the same way: the person runs `scripts/install-node.sh`, which installs the official LTS build from
nodejs.org, checksum-checked, into their home folder (no password).
Each step is written to be read alone, for someone new to all of it: it names the terminal copy of Claude Code, says
what Node.js is, and says how to start the command from the chat (the ▶ button in the desktop app).
`scripts/setup-check.sh` (plain shell, so it runs before Node is there) only checks both and, with `--wait`, notices
when a step is done so setup carries on by itself; it never installs or signs in. verify checks it again as a backstop, and the panel's
reminder points back to the chat ("Connect uberdesigner studio to Claude Code"), with the terminal commands folded
underneath. It's for the person's own machine: don't host it for others or route their requests through one account.

To update the studio in a project after changing `runtime/` (run `pnpm build:panel` first if the panel changed),
run `node scripts/apply.mjs <project> <project>/inspector.map.json` again: it replaces `.inspector/tool/` and leaves
everything else as it is. Projects set up with the earlier layout (`src/inspector/`, `vite.inspector.ts`, a mount line
in `main.tsx`) are migrated by the same command.

## What a change sends

A part's change sends the part's prompt lines, its tokens, the facts, and **automatic context**: small files (under
about 9k characters) go whole; in larger ones only the part's pieces go: its markup, the CSS rules for its classes and
their keyframes, the script functions that touch it (at most four, ranked by the part's classes and the request's
words), and the `:root` tokens. A request about motion or wording also reaches the matching `extraFiles`. The panel
lists what will be sent before the run, with a size and a time estimate; **pick files** switches to choosing by hand.
**Which CSS rules are the part's is asked of the page.** The browser knows which rules apply to an element; class names
in the source only hint at it. When a change is asked for in the editor, the panel lists the rules that match the
part's own elements, from every stylesheet of the page and for every screen size, with hover and other states
included, and the server finds each one in the site's files by its selector and its place among rules with that
selector. Those are sent, along with:
- the same element in a state it isn't in now (`.card.is-open`), which the page can't show;
- the layout rule of the element around the part (its grid or flex), so "hide this" doesn't leave a hole;
- a rule in **another stylesheet** that sets the same thing as one of the part's own rules, since it may win over the
  change or lose to it. Only that rule, never the file;
- of the `:root` token blocks, the first and any that set a value those rules use (not every breakpoint's block).

A rule that only passes through one of the part's class names on the way to something else is no longer sent. With no
page to ask (the size report in `verify.mjs`, a file whose rules a build step rewrote), the match by class names
decides, as before.

If Claude says it needs another file that exists, the studio reruns once with it, **unless that would make the
request larger than about 20k tokens**: a big file is never sent whole unasked. Then the change stops and its card lists
the file with its size, like anything else Claude asks for (new packages, new files, files outside the list): a
question with **Allow and run**. The same limit holds for the one automatic fix call after a failed check: when the
changed files are too big to resend, the card shows the error and waits for a reply.

Each change is a card, listed newest first in the editor's **AI changes** tab, and a small loop: **ask, look, refine, then keep or undo**.
- While Claude works, the card has a small animated icon, the part, the request, a progress bar with the time left,
  and the step (picking context, thinking, writing, applying, checking). The part pulses on the page.
- Then it's ready for review. **‹ ›** steps through **Original, Try 1, Try 2…**: the card shows each try's request
  and what Claude did, and the live page shows that state (later tries' edits are reversed in the files without
  recording a version, and put back the moment anything else writes; a file you edit yourself meanwhile keeps your
  edit: it's carried onto the latest state, or, if it touches the same lines as the change, the file is left as you
  have it and the card says so). **Use this one** goes back to the state you're
  looking at: the tries after it are taken back as one version, and the next refinement continues from there. (To see
  an intro or load-time motion again, the replay button is in the editor's toolbar.)
- **"Not quite? Say what to change…"** sends a refinement as try 2, 3…, with the earlier tries (what was asked, what
  Claude did) as context: "this doesn't look like ice yet, make it more like ice".
- **Keep** accepts it. **Undo** takes back every try of it as one new version, keeping changes made after it. Either
  way the card isn't thrown away: in the editor it moves to the **Resolved** tab, beside AI changes (always there,
  empty until something is resolved). There a kept change can still be undone on its own, and a change that is out of the page (undone, or left
  behind by going back in History) has **Bring back**, which puts it on the site as it is now with everything made
  since kept. When later work rewrote the same lines, Undo or Bring back says so and touches nothing: History is the
  way back, or asking for the change again in the card's field. A resolved card can't be taken off the list: it is
  the record of what was changed (a card that changed nothing can be closed). Tries that were taken back stay on the card ("taken back"), and Claude is told about
  them in later refinements, so it doesn't repeat what you rejected.
- **Every change has a number**, in the order they were asked for, and keeps it: it is on the card, and on a violet
  pin over the part the change is about. The pin is there while the change waits on you (running, or made and not yet
  kept or undone) and leaves the page on Keep or Undo; pressing it shows the card. Nothing frames the changed part
  itself, so the change can be seen as it is (while Claude works the part still pulses, and it has an amber
  "Before · name" frame while a card shows the original); the list has a "changed" chip.
- Once a card is finished it turns solid (it's see-through glass while Claude works), and **clicking anywhere on it**
  that isn't one of its buttons takes you to its part: the site scrolls there and its layer opens (on the site's own
  page, it opens the editor on that part). On a page that doesn't scroll, the part is just outlined and opened.
- A card under the pointer, or one being typed in, comes to the front of anything it overlaps.
- Cards are saved in `.inspector/cards.json`, so they survive a reload and a dev-server restart.

**History** (the second tab on the left) is the way back to the whole site as it was. It lists points, not every
action: each **Save**, the starting point, where a work session started (the version current before the first change
after the editor opens or after half an hour's pause), the moment before a whole-site change and before going back,
and one every ten versions when none of those came up. **Go back here** puts the whole site back as it was at that
point, as a new version, so it can itself be taken back. **Every step** shows every version there is (each try, each
typed word, each undo): from there one edit the studio wrote itself can be undone alone.

Cards and History can't disagree, because both read the same thing: every version records which changes the page
holds at that version (a change adds itself, Undo takes one out, Bring back puts it in again, going back copies the
list of the version gone back to). Whether a card says Changed, Kept or "Not in the page now", whether a layer is
marked as changed, and what History marks "(not in the page now)" are all read from the newest version's list; no
flag is kept beside it.

**When the map falls behind the site.** The map is written once, so new sections or components added later (in an
editor, another Claude chat or a Whole site change) aren't parts yet. The studio checks for this for free, without
spending tokens, when the dev server starts, when the panel loads, after each change and when the window gets focus.
It reports files the map names that are gone, parts whose `data-dm` tag left the code, page files that are new
since the map was written and that no part covers, and a build prompt edited after the map. When it finds any, the
terminal prints one line, and the top of the parts list says "The map is
behind the site", with the reasons and a **Copy the request** button for Claude Code ("update the uberdesigner studio map"). New
files are judged against `.inspector/map-baseline.json`, the page files there were when `apply.mjs` wrote the map. A
map written before that file existed gets its baseline the first time the check runs. Tested 2026-11-13 on copies of
two test sites: a removed tag and a new file were caught, and the note cleared by itself once the
code matched again. No false alarms on the 11 mapped test projects.

**The page is never reloaded at a moment you didn't choose.** Stylesheets always show at once: through Vite's hot
updates, and on sites with no build step by swapping `<style>` blocks or stylesheets into the open page. Values you
save, words you type and pictures you replace are on the page already. Code is different. A change to scripts or
markup on a site with no build step can't show without a reload. On a Vite site the dev server swaps a changed
component into the page and reports it as done, but code that was already running keeps what it started with: a loop
a component began (an orbit, a counter) goes on at its old speed. So when a change you asked for wrote code, a bar
over the page (in the editor: at the top of the canvas, under the toolbar) says "Your change is in the code. Reload the page to see it." with a **Reload page** button that a soft ring leaves every few seconds until it is pressed; the page
comes back to where it was scrolled. A click that asks to see another state (Undo, a try, a comparison, going back in
History) reloads at that click when the page needs it. For files changed by other hands (an edit in a code editor)
the dev server's hot update is left to do its work; when it asks for a full reload, the same bar names the file.
Tested 2026-11-13 on a plain HTML site (a style edit applied live, a script edit offered Reload) and Umbrela (an
`index.html` edit offered Reload); 2026-11-17 on Stillwind, where a faster logo ring took three requests to notice
(the speed in the code was right on the first; the page kept the old one, and nothing said so): now the bar appears
after the first, and Undo shows at its click.

Estimates start from typical times and learn from the project's own runs (`.inspector/stats.json`: the median per
model and mode, scaled by input size).

## Several changes at once

Up to three part changes run at the same time: Claude thinks and writes them side by side, and the studio applies,
checks and records them one at a time, each as its own version. More requests wait their turn. So do a second request
for the same part, and **Whole site** changes, which run alone. Parts in the same file are fine: edits are exact
find-and-replace pieces, not whole files. If another change has already rewritten the lines an answer needs, that
request is asked again once against the current file. **Undo** takes back one change (all its tries) and keeps the
ones made after it. If a later change rewrote the same lines, it says so, and History (going back to before it) is the way.
Tested 2026-11-13 on a single-file HTML site: four requests (three at once, one queued behind the same part) all
landed in its one `index.html` as four versions, and undoing the second kept the other three.

## Who can call the studio

The studio's API (`/__inspector/…` on the dev server) can start Claude Code and write the site's files, so it
answers only its own pages. Every request must be addressed to this computer (`localhost`, `127.0.0.1`, `[::1]`) and,
when the browser says where it comes from, come from the same address: a page on another website open in the same
browser is refused. Anything that changes something must also be sent as JSON and carry the site's token. The token is
made once per site and kept in `.inspector/token`; the panel gets it with the page, and a program on this computer (the
backtest, your own script) reads the file and sends it as `X-Inspector-Token`. The rules and their reasons are in
`runtime/server/guard.ts`.

If you open the dev server under another name (a `mysite.test` in your hosts file), start it with
`DESIGN_INSPECTOR_HOSTS=mysite.test` (comma-separated for several).

## What a save may write

A value typed into a token's field is checked before it's saved, in the panel as you type and again by the dev server
(`runtime/server/values.ts`): its brackets and quotes must be closed, it can't hold anything that would end the
declaration early, and a colour stays a colour, a time a time, a size a size. A field that can't be saved turns red
and says why. One bad value stops the whole save, so a save is never half written.

## What the studio checks on the page

The server can't see the page and neither can Claude, so the panel looks, and it costs no tokens:

- **After a change by Claude lands**, the part is compared with how it looked when the change was asked for: its text,
  how many elements it holds, and about fifty computed properties (box, type, colour, spacing, transform, timing). If
  nothing differs at the size on screen, the card says so next to Claude's own words ("Nothing on Hero title looks
  different at 1440 px"): a change that only shows on phones, or a rule a later stylesheet overrides. Hover states,
  motion over time and anything drawn inside a canvas aren't checked, and the line says so.
- **Layers a change added** are looked for on the page. One the page doesn't draw is named on the card.
- **When a layer is picked**, each of its values is checked against the page's own rules. A field says so when no rule
  on the layer or inside it uses the value, or when a rule uses it but a later rule sets the same thing, so changing it
  moves nothing. The studio only says this when it is sure: a value used in a hover state, by a class a script adds,
  in a rule for another screen size, or in a way the browser can't spell out is left alone.

And on the server, after every change by Claude, the stylesheets it touched are checked along with the typecheck or the
script parse: a rule left open (a brace, a comment or a quote that never closes) goes back to Claude once with the
error, as a failed typecheck does.
