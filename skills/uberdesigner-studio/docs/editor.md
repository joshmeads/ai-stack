# Using the editor

[← Back to the README](../README.md)

Everything the editor does, column by column. For the short version, see the README.

## Open it

`pnpm dev` (Vite) or `node .inspector/tool/server/serve.ts` (no build step; port 5310), then open the site's address:
it opens in the studio, on whichever page of the site the address names. There is no plain view of the site to pass
through first: **Preview** shows the site alone. To have the site by itself in a browser tab (to compare, or to show
someone), add `?studio=off` to its address once: that browser then gets the plain site until `?studio=on`.

**In the Claude app's own browser,** the pane beside the chat, the editor is covered while that pane is narrower
than 958 px (the two side columns and a phone-sized frame between them): "The studio needs a wider window", with
the editor's address and a **Copy link** button, since the same localhost address opens in any browser on the
computer. **Continue here anyway** (or Escape) takes the cover away for that tab, and widening the pane takes it
away by itself. An ordinary browser is never covered, however narrow its window: the app's browser is told by its
user agent (`narrow.ts`).

**The editor** (`/__inspector/editor`; the site's own address leads there):
- **Top bar.** The uberdesigner logo opens the About card (the website,
  the templates, X, GitHub and Discord; Escape closes it). The bag beside it opens uberdesigner's template library, after
  asking. Then the site's name, and at the right the Light / Dark switch.
- **Toolbar.** The mode, the sizes (Desktop XL 1920, Desktop 1440, Tablet 768, Phone 390) with the scale the site is
  shown at, Preview, and at the right the replay button.
- **Focus and Design.** Two ways to work on the same site. **Focus** is the site, the request bar and AI changes:
  nothing else to read. **Design** adds the layers on the left and Elements on the right. **Resolved**, beside AI
  changes in both, holds the changes that were kept or undone. Picking on the page, the
  request bar and the cards are the same in both, and switching keeps the picked layer, the words typed in the
  request bar and the size. A site opened for the first time starts in Focus; after that the mode is kept. In Focus,
  the line that Elements' footer would show (a text typed over and saved, with its Undo; unsaved live changes with
  Reset and Save) appears under AI changes when there is something to say.
- **Light and dark.** The switch at the right of the top bar picks the studio's theme. The first time it is the
  computer's; after that the choice is kept for that site's address. Only the studio's own chrome changes: the site, and the outlines and labels drawn over
  it, look the same in both.
- **Left (Design): layers.** The map's parts as nested layers, like a design file: each section (Hero, Tour) holds what's in
  it, and a part made of pieces holds them (a two-word name holds each word). The chevron opens a layer; the
  row picks it, sections included. Each layer has an icon for what it is (section, frame, text, image, video, button,
  icon, 3D scene, list): from the map's `kind`, else read from its element. Which layer sits in which, and their
  order, are read from the page: a layer is listed inside the nearest layer its element sits in and in the order of
  the page, so a change that moves or swaps things moves their rows. The map's own `parent` and order hold only for
  what the page can't say (a layer with no element on this page, a layer in a group that has no element at all). With
  no nesting anywhere, the parts are listed flat under group folders. The tabs are Layers, Assets and History, with Pages first on a site that has more than one page. The list is the
  page's own tree: under a layer it also has a row for every text, picture, button and box the map never listed,
  read from the page when the row is open (rows that hold layers of the map are open as before; a row that holds only
  unlisted things starts closed). Any row picks its thing in one click and scrolls the site to it; the pointer on a
  row outlines the thing on the page, and picking on the page shows the row and opens the rows above it. On the site,
  **a click picks the block under the pointer** and **a double-click goes inside it** (see
  [Picking: the click rule](internals.md#picking-the-click-rule)). Parts not visible at the current size or scroll say
  "hidden". The "map is behind the site" note sits on top. **Add new object** floats at the bottom of the list: it
  puts "Add " in the chat bar for the picked layer (or the whole site), lit up and ready to type; Claude builds it,
  tags it, and it joins the layers under that layer.
- **Left: Pages** (only on a site with more than one page). The site's pages, Home first: the page the frame shows and
  the pages its links go to (same site, not a file to download), named by a link's words or else by the address. A
  React site's routes and a plain site's `.html` files are found the same way, by the links on the pages opened so far;
  a page nothing links to is listed once it has been opened. A row opens that page in the frame; the open page is
  outlined. With no build step, an address with no extension that has no file of its own is served from its `.html`
  file (`/security` from `security.html`), as hosts with clean addresses serve it, so such a site's links work here.
- **Left: Assets.** The pictures and videos the open page shows, one row per file in page order, with a thumbnail,
  the file name and the layer it sits in (or how many places use it). It is read from the page at its current size:
  `<img>`, `<video>` and its poster, SVG `<image>`, CSS backgrounds, and, last, files the site's code loaded without
  putting them on the page (a texture for a canvas or WebGL scene: "Used by the site's code", not pickable). A row
  picks the thing that shows the file, as a click on it would, and scrolls the site to it; Assets stays open, and
  Elements has its **Replace…**. **Find an asset…** filters by file name or layer. The list is read again after each
  change, each load of the page, and once more a few seconds after a load (lazy pictures and textures come in late);
  **Read again** reads it now.
- **Middle: the site** in a frame at **Phone 390 × 844, Tablet 768 × 1024, Desktop 1440 × 900 or Large 1920 × 1080**,
  scaled down to fit with the zoom shown. The site runs at that real width, so its media queries and scripts behave
  as on that screen. The mouse picks things (the wheel still reaches the site, so scrolling and wheel-driven slides
  work), and nothing is outlined until the pointer is over something: one outline, on what a click would pick, with
  its name. **Preview ▶** (top left) shows the site alone, as a visitor has it: the editor's columns and bars step
  aside and the site fills the window at full size, the mouse is the site's, and its links work, so every page can be
  walked through. A bar on top has **Back to editor** (or Escape), a reload button, and a size menu (Window, or one of
  the devices). It is the same frame as in the editor, so coming back finds the page where it is now, the picked
  layer still picked and the editor's own size as it was. Holding Option hands the mouse to the site in place, for a
  moment; the button then reads **Stop preview** and stops it whatever started it (Option is read from every key and
  mouse event, so a release the editor never heard, with a screenshot tool in front, can't leave the page in
  preview). The replay button (top right) reloads the site and plays its intro again.
- **Typing over text.** While picking, double-click words, at any depth: that text is picked and you type over it
  where it is; Enter keeps the words, Escape puts them back. When those words are written out exactly once in the part's source (between
  its tags in a plain HTML page, as a whole string in a React component or a words module the map lists in
  `extraFiles`), the dev server swaps them in the file itself: no Claude call, no reload and no card. The footer says
  "Text saved to the file" with **Undo** beside it, and History keeps the version. Otherwise it doesn't guess (the
  same words twice, as with a phone copy; words the page's code makes; formatting changed inside the text; characters
  that need escaping in code): nothing is written and nothing is sent. The footer says why, with **Ask Claude (about
  N tokens)** beside it; only that button makes it an ordinary change of that part. Words an animation splits into letters are typed in a box over them instead, so the
  page's own letter elements are left alone (editing them in place would break the code that animates them).
- **Right: two tabs under the tokens-saved badge.** **Elements** holds the picked part's values; **AI changes** holds a
  card per change (below). Starting a change opens AI changes; a violet dot on the tab says a change is running or
  waiting to be kept or undone, so one that finishes while you're on Elements doesn't pull you away. Clicking a
  finished card opens its part in Elements.
- **Elements: properties.** **‹ ›** at the top step back and forward through what you picked, like a browser (⌘[ and
  ⌘]); they never undo anything. These and **I** go by the sign on the key, so they work while the keyboard types
  Russian or any other alphabet. Under the name, the layers it sits in ("Hero ›"), each a click away. Then the
  picked part's note, its latest change (progress, result, Reply, Undo, and **Allow and run** when Claude needs a
  package or another file), and its values:
  - **Its own values only** ("Headline only"), then the text values it takes from the layer it sits in ("Word only ·
    from Name": size, font, colour), changed for this layer alone. A layer's values change that layer and
    what's inside it: the edit goes on its elements live, and **Save** writes a `[data-dm="…"]` rule (for a layer found
    by a selector, a rule under that selector) after the tokens
    file's `:root` blocks (for an outer layer's value, with the property that reads it again, `font-size:
    var(--fs-name)`), with the phone value kept in the phone media query so phones look as they did.
  - Each value shows its plain name and its control: a slider and a number for sizes, a picker and hex for colours,
    **a Google Fonts picker** for fonts (search, filter by kind, hover to preview; Save adds the family's stylesheet
    to the page's `<head>`), and **a graph editor** for easings (29 presets from CSS's own to Expo and Back, the two
    handles dragged on the curve, the four numbers, a replay dot). **Show more** opens the code name, the prompt's
    note, the CSS value and the phone value.
  - **Link** for a button or link: its address, set in place. **Image** / **Video** for a part that shows one:
    **Replace…** picks a file on the computer, saved into the site (`public/media/`, or `media/` next to a plain page).
    **Effect** for a part whose map lists `params`: sliders for numbers in its code (a shader's ripple size, a
    constant's speed), written on release. Each of these is written straight into the file when the studio is
    sure where it lives (the string written once, or once in the part's own tag): no card, the footer says it is
    saved, with **Undo**, and History keeps the version. When it isn't sure, nothing is written or sent: the value
    goes back, the footer says why and offers **Ask Claude (about N tokens)**. A direct edit never becomes a request
    to Claude by itself.
  - **Animation**, below all the other settings: the layer's durations, delays and easings. **▶ Play** (in the
    section's title, beside each easing graph and duration, and in Effect) shows the animation again on the page with
    the values being edited: CSS animations restart; reveals switched on by a state (`data-ready`, `data-inview`,
    `.is-visible` on the layer or around it) replay from their start; motion the page's script runs (GSAP, a canvas)
    replays by reloading the site, with live edits kept.
  - **Delete layer**, at the very bottom: Claude removes it from the code (with the styles and code only it uses). Undo on its card, or
    History, brings it back.
  **Global tokens**, every token in the map grouped by the prompt's own sections, show under Whole site or with
  nothing picked; a change there reaches every part. A change that adds something registers it as a layer (tagged,
  in the map under its parent), and a removed one leaves the list. The list follows by itself, in the open editor:
  the map is read again whenever it changes on the server (a change, an Undo, a restore, the skill applying a new
  map), and the new layer can be picked at once.
- **The chat bar** under the site asks for a change to the picked part, or to the whole site when nothing is picked
  (the chip's ×). Enter runs it, Shift+Enter adds a line. It shows the model, effort, estimated tokens and time;
  clicking the estimate opens what it sends (the files it picked), or lets you pick them by hand. **Explore 500+
  Prompts** asks first, then opens uberdesigner's prompt library (uberdesigner.ai/library) in a new tab.
- **Look.** uberdesigner's own: Instrument Sans (bundled in the panel, its licence in `runtime/panel-src/fonts/OFL.txt`,
  under its own family name so a site's fonts are never affected), grey columns, and violet for actions and the
  picked layer (Run and Add new object are uberdesigner's primary button). Figma: "uberdesigner — app design", page
  SKILL.
- **Tokens, never prices.** Each change's card shows the tokens it used and what it saved ("2.4k tokens · saved
  ~32.6k"). The top-right corner shows **Tokens Saved by uberdesigner**: the total saved across every site and chat on
  this computer, kept in `~/.uberdesigner/design-map/totals.json` (server/savings.ts) and read again after each change.
  Milestones work like a streak or a rating: the badge takes the colours of the highest one reached (grey to start,
  green at 100k, blue at 1M, purple at 10M, gold at 50M, pink at 100M, teal-violet at 500M; 10M and up shimmer),
  with a bar to the next one. A new saving counts up and floats "+50k" above it; passing a milestone pops the badge,
  throws sparks and says "10M saved!" for a moment, once per milestone per browser (none of it with reduced motion).
  Clicking it shows tokens saved, tokens used, changes, the milestone ladder, this site's share, and how it's
  estimated. Savings are our own estimate from our test
  ([How we measure the savings](methodology.md)): each change counts the difference between plain
  Claude Code's median for an everyday change and what the change actually used. Typed text, links and sliders use
  no tokens and count all of it; Whole site runs save nothing. Nothing runs on the person's computer to measure it.
  The Whole site run's limit is shown by size (Small to Very large) rather than by spend.
