# NACRE: a VEYL-shaped fixture

A tiny site with the shape of the tester's site from the 15 Nov report (VEYL): plain HTML served by the inspector's own
server, colours as CSS variables in `:root`, and the situations that report found problems in.

| In the site | What it is for |
|---|---|
| `style.css`, then `mobile.css` | Two stylesheets: at phone width `mobile.css` resets `.archive__strip` to `padding: 0`, so a padding added in `style.css` doesn't show (report P4) |
| `--ink` on the section menu | A colour token on a layer, to type an invalid colour into (P5) |
| `.prologue` | A pinned section; its second line only shows in the second half of its scroll (slow searches in the report's layer check) |
| `.colony__spider` | An element that moves forever and is transparent at each end of its loop |
| `.colony__cocoon` | Shown on phones only: not displayed at desktop size |
| `.story` | A pinned story nine screens long: nothing of it shows at its top (as when the scene before still fills the screen), then a picture and one line at a time, the other eight transparent. On screen all along, and found a screen into its own height (the friend's report of 16 Nov, N3) |
| `.woven__title` | A title whose letters are transparent, waiting for a reveal: on screen, nothing to see, and said so |
| `.steps`, `.step` | A row of three cards that are one layer of the map on three elements; the heading and the line inside each are not in the map (picked together by a click; going inside reaches one card) |
| `.scene` | A canvas that fills its section and is a layer, with words laid over it that are not (reaching what sits over a layer with no insides); and a second line stacked on the first whose letters aren't shown yet (a pick lands on the line that shows) |
| `.contact__note` in `.contact__card` | A layer inside a styled box that is not a layer: the box is the block a click picks, the note is one level in and listed under the box's row |
| `.contact__maker` | A card with a picture, a heading and a line, none of them layers: each is picked on its own, the card first (the nested-edits scenario) |
| `.crowd` | A layer holding six balls and one map picture, none of them layers; the balls sit in a layer that is never outlined itself and lets clicks through: each ball is picked alone by a plain click, each has its row, and the picture is picked from its row |
| `.pile` | A pill under a card with an opaque gradient fill (covered: no outline, its row says hidden) and one under a veil that fades to nothing (in view: outlined) |
| `.dock` (added by `app.js`) | A small fixed panel the script adds to the page, in no section and so in no layer, with a light that pulses in CSS: the page is the outer layer, so it is picked like anything else and kept by its place on the page |
| `.drawer` | Fixed to the screen and hidden until a button adds a class: no scroll position shows it (a search that can only fail) |
| Four bands, two founder cards, a contact section | Enough layers for a change to add one (a block after Contact, P2 and P3) and to swap two (P1) |

`inspector.map.json` is the map; the pages carry no tags (the suite's copy is tagged by `apply.mjs` of the version under
test). Used by `tests/sites/sites.fixtures.json` and `tests/browser/veyl.mjs`.
