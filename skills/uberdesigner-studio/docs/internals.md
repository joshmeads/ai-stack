# Internals: layers on the page

[← Back to ARCHITECTURE.md](../ARCHITECTURE.md)

For someone changing the code: how a layer of the map is found on the page, what a click picks, and how the editor
decides whether a layer is on screen. The pieces and the rules they keep are in
[ARCHITECTURE.md](../ARCHITECTURE.md); what a person using the editor sees of all this is in
[Using the editor](editor.md).

## How a layer is found on the page

A layer of the map is an address, and the page is asked for it in one place (`runtime/panel-src/inspector/resolve.ts`;
outlines, picks, jumps, Play, text editing and live values all go through it):

- **A tag.** `apply.mjs` writes `data-dm="<id>"` onto the element in the source. The attribute is the studio's own,
  so a site that uses `data-part` (or anything else) for itself is never touched, and its elements can be layers too.
- **A selector.** For what the source can't tag (the element a component renders without passing props on, markup a
  script or a generator writes), the map gives the layer `"targets": [{ "selector": "[data-dm='features'] h2" }]`.
  Nothing is written into the code. While the editor is open the matching elements get the same attribute on the page
  only, and are marked again whenever the site draws them anew, so everything else treats both kinds alike. The
  layer's own values are saved under the selector itself, since the mark doesn't exist on the real site. A change to it
  tells Claude which element it is in one line, with the code of the tagged layer it sits in.
- **Nothing.** A piece inside a canvas has no element: it's listed for its settings and never outlined.

### Picking: the click rule

The running page is the source of what can be picked, not the map. One rule (`objects.ts`) says what a thing is, and
`tree.ts` reads the page as a tree with it: sections, the blocks inside them, the parts inside blocks, however many
plain wrappers sit between. The map is laid over that tree: it gives names, files and values to the things it lists.
The rest are named from what they are (their words, a picture's alt text or file, a box's class name).

A thing is a layer of the map; a block of words (the element whose line of words it is: never one letter or word of
a title split into spans); a link or a button; a picture, a video or a drawing as a whole (never a line inside a
drawing or a piece of a canvas); or a box with a look of its own (a fill, a picture behind it, a border, a shadow).
A box that only holds other things and paints nothing is not a thing: what it holds sits directly under the thing
around it. A wrapper around the map's top layers is never one either: the map decides the sections. The page itself
is the outer layer: what no layer holds (an overlay, a preloader or an app mock-up a script adds to the page) is a
thing at the top of the tree, picked like anything else, addressed from the nearest element around it with an id of
its own or from `<body>`, and kept by that address with no file touched. One exception: a veil over the whole screen
that lets clicks through and that the map doesn't list (grain, a vignette) is picked from the list only, or every
click on an empty place would land on it.

The rule (settled 17 Nov 2026, close to Figma), with no key to hold:

- **Moving the pointer** shows one outline, on what a click would pick right now, with its name. Nothing else is
  outlined: there are no boxes around every layer at rest.
- **A click** picks the block under the pointer: the thing right under the section there (a card, a headline, a
  picture). A section is picked on its own space, or from the list. A thing at the top that isn't a section (a card or a dock
  outside every section, a layer of a map that has no sections) is itself the block: a click picks it, a double-click
  goes inside. A section is what the map calls one, a section, header, footer, nav or main element, or anything about
  as wide as the page.
- **A double-click** goes inside the picked block and picks the part under the pointer. From then on the pointer and
  single clicks work at that level, inside that block, whose edge is drawn dashed. A click on the block's own space
  picks the block again.
- **A double-click on words** picks that text and starts typing, at any depth. "On words" means the smallest thing
  under the pointer is a block of words: words lying behind a card are never typed over through the card.
- **A click outside** the block you are in is back at block level. **Escape** goes up one level; at block level,
  nothing is picked.
- **A row of the list** picks its thing in one click, at any depth.
- **Look-alikes** the map lists as one layer on several elements (three plan cards) are picked together; going
  inside reaches the part in the one card under the pointer, and that card's edge is the dashed one. Things the map
  doesn't list are never grouped: each is picked alone.
- **⌘-click** (Ctrl on Windows) picks the smallest thing under the pointer in one click. A shortcut; nothing needs it.

What is under the pointer is the smallest thing a person sees there. Seen means shown by the same reading the
outlines use (`presence.ts`: on screen and inside what clips it, not hidden or as good as transparent, not only words
nobody can see yet), its words show (a line typed in letter by letter, or one of several lines stacked in one place
that take turns, has its box while nothing of it shows, and is passed over), and nothing solid is painted over it at
that point. Of things of about one size that aren't one inside the other (stacked screens, a full-screen canvas
behind a full-screen section), it is the one painted on top; and when a thing is bigger than the thing it sits in (a
portrait hanging out of its small round holder), the inner one wins. It is looked for from the top of the tree down
by box, so a thing that lets clicks through (words laid over a canvas, a decoration) is found, and from what the
browser hits at the point up, so a thing that hangs outside the box around it is found too. Things of about the
same box in a row (a section and the wrapper that fills it, a card and the picture that fills it) are one step: the
outer one, or the one the map lists; the inner one is reached by going inside. A layer marked `"outline": false` (a
full-screen scene of bubbles) is never picked on the page: what it holds is picked as if it weren't there.

The click and the outline ask the same question of the same tree, so the box under the pointer is what the click
picks. The tree is read when asked, only along the branch under the pointer or under an open row, and kept until the
page's structure or the map changes; each frame only what is drawn is measured (the picked thing, the one under the
pointer, the dashed edge), and every layer's presence a few times a second for the "hidden" marks. Both costs are held to a share of
the time, whatever the page: reading the tree to 3% (on a page that changes every frame, what was read is kept
longer, so the list follows the page a little later), and looking up what is under the pointer to 6% (on a heavy
page or a slow computer the outline follows the pointer a little later rather than the page stuttering).

**The selection stays on its thing.** A layer of the map is picked by its id. A thing the map doesn't list is
followed by its element while the page changes around it (its address is read again when something is added or
removed beside it), found again by its address and checked by its tag and words when the page or the editor reloads,
and at another device size it is the same element. If it is gone, the editor says so and picks the layer it sat in
(after a reload it waits out the page's intro first: things aren't in their places yet).

The dashed "not shown" box answers "why can't I see what I picked": it shows for a layer picked from the list that
the editor couldn't bring into view. Once a picked thing has been on screen, scrolling away from it leaves no box
behind.

A click adds nothing anywhere: picking is only looking. A thing the map doesn't list is outlined like a layer while
it is picked, addressed by its place under the nearest layer the code is tagged for (in one card of a row of cards:
that card's), and let go when something else is picked. Words typed over belong to the layer of the map they sit in:
typing makes no layer. It becomes a layer of the map when it is changed for the first time (a request to Claude, a
saved value, a link, a picture, a setting) or by **Keep as layer**, with no call to Claude (`server/layers.ts`):

- On a plain HTML page, the element is found in the file by the same place (`html-tree.ts`: which of how many
  siblings with that tag, level by level), and checked against the page: its tag, its classes, its first words, its
  picture's file. When all agree its tag is written into the source, as a version in History, and it is a layer like
  any other: a change to it sends its own lines (on a 240,000 px story page: 2.1k tokens for one quote, 6.3k for its
  section).
- Otherwise (a component's markup, content a script builds, a source the scan can't follow) no file is touched: the
  map keeps its address on the page, and a change to it sends the layer around it. When the words on the page aren't
  the words in the file, the editor says a script sets them, so typing over them won't hold.

When the page doesn't answer an address, the editor says so and doesn't guess. A layer with no element on the page is
marked "not on page" and picking it says why (a component that doesn't pass its tag on, a selector that matches
nothing); its own value fields aren't offered, and the server refuses a value saved for it, because the rule would
change nothing. A page that carries none of the map's layers says "this page carries none of the map's layers" instead
of marking every layer hidden.

### Whether it is on screen, and bringing it there

An element having a box isn't enough on a page that moves (`presence.ts`). A layer is **shown** when its box is on
screen and inside every parent that clips, it isn't hidden or as good as transparent (faded to under a tenth through
itself and what it sits in: a card at the far side of a turning ring), nothing solid is painted over it (an opaque
colour, a picture, a video, a gradient whose colours are all opaque; a veil that fades out leaves it in view), and
what it has on screen isn't only words nobody can see yet. A layer something is painted over has no outline and no
hover box: where things are piled up, only what is on top is highlighted. That last rule looks at what is on screen now and nothing else: a title
whose letters wait for a reveal is not shown; a long story that shows its scenes in turn, with most of its words
transparent at any moment, is shown as long as one line, a picture, a video, a filled box or a layer inside it is.
A turned element is outlined at its own size around its middle, as it is drawn (scaled too), not at the box around
it, which would breathe as it turns.

Picking a layer from the list brings it into view, in this order, and stops at the first place it shows:

1. where the map says (`"at"`), if it does;
2. where it was last seen: the editor notes where every layer shows while the page is scrolled, by anyone, and keeps
   that per page and width for the next visit (the browser's local storage);
3. its own place: in the middle of the screen, or from its top when it is taller than the screen;
4. for a layer inside a pinned stage, or one far taller than the screen (the track a pinned story scrolls along), steps
   along that range: ten coarse ones, then the halves between. A layer fixed to the screen is stepped for across the page.

An ordinary element that isn't shown at its own place is not searched for: no scroll position would show it. The
footer says why ("not displayed at this size", "transparent or hidden…") with **Look for it** for a longer search. A
search has a budget (4 s, 7 s in a pinned story, 20 s when asked for); the row says "mapping…" for exactly as long as
it runs, a scroll or a click ends it, and a search that found nothing puts the page back where it was.

### Maps made before 16 Nov 2026

A map made before 16 Nov 2026 has `data-part` tags. Running `apply.mjs` on it renames them once (the map's `"tag"`
field then says `data-dm`), along with the rules saved or written for them. If the site's own code uses `data-part`
too, the old tags are left where they are and the new ones are added next to them. History kept from before the
rename still has the old tags, and the map isn't part of History: after restoring a version that old, `verify.mjs`
says so, and `apply.mjs … --rename-old-tags` renames them again.
