# Changelog

What changed in uberdesigner studio that a person using it would notice, newest first. Work on the code that changes
nothing for them (refactors, tests) is in the git history only.

<!-- DRAFT: the studio has no version numbers yet, so entries are grouped by date. If releases get numbers, each
     group gets its number and date as its heading. -->

## Unreleased

### Changed

- **A new look, in light and dark.** The studio takes its colours, type and sizes from uberdesigner's design: a
  light and a dark theme with a switch at the right of the toolbar (the first time it follows your computer), violet
  for what is chosen (the open tab, the picked layer, the size), larger type and controls, and a dotted canvas.
- **The site opens in the studio.** Open the site's address and you are in the editor, on that page: the plain
  site with its Inspect button, the **I** key and the back arrow are gone. Preview shows the site alone;
  `?studio=off` on the address gives a browser the plain site.
- **Focus and Design.** The editor has two modes. Focus is the site, the request bar and AI changes; Design adds
  the layers and Elements. A site opens in Focus the first time; switching keeps what you picked and typed.
- **A top bar:** the uberdesigner logo (it opens an About card with the templates and the
  community), the template library, the site's name, and the Light / Dark switch. The sizes are named Desktop XL,
  Desktop, Tablet and Phone.
- **Tokens Saved has the design's colours,** one per milestone, and a new milestone at 1B. Its details link to the
  method on GitHub.
- **Changes are numbered.** Each change has a number on its card and on a violet pin over the part it is about;
  the pin leaves when you keep or undo the change. The green "Changed" frame over the part is gone: it covered what
  it pointed at.
- **Resolved is a tab,** beside AI changes: the changes you kept or undid rest there with their numbers, and can no
  longer be taken off the list. The replay button is in the toolbar only (the cards had one too).
- **Preview is a full view of the site.** The editor steps aside and the site fills the window, with its links
  working, so you can walk through every page; **Back to editor** or Escape returns to where you were, with the same
  layer picked. A menu there picks another size. Holding Option still tries the site in place.
- **The reload notice** is at the top of the canvas, under the toolbar (it used to cover the size switch), and a soft
  ring leaves its button until you press it.
- **The name.** The skill is now uberdesigner studio; it was design-map, and its editor the design inspector. Claude
  Code knows it as `uberdesigner-studio`. What it puts in a site keeps the old word (`.inspector/`,
  `inspector.map.json`), so sites set up before the rename keep working.
- **The licence.** uberdesigner studio is under the GNU Affero General Public License, version 3 (AGPL-3.0-only),
  with one added term: the credit stays in every shared version ([NOTICE.md](NOTICE.md)). Earlier it was under
  FSL-1.1-ALv2.
- **Picking is by clicks alone.** A click picks the block under the pointer, a double-click goes inside it, a
  double-click on words types over them, and Escape goes up. Nothing is outlined until the pointer is over something.
  The layers list has a row for every text, picture, button and box on the page, whether the map lists it or not.
  The "Not in the layers" offers under the list are gone: those things are rows now.
- **Setup reads one step at a time.** Each setup step says what it is for without the steps before it, and the
  hand-over ends with the link to open.

### Fixed

- A picture with a relative address (`hero.svg`) showed a broken thumbnail under Elements → Image.
- The replay button's icon sits in the middle of its button.

### Added

- **The editor tab has the uberdesigner icon,** the black mark. The site's own tab keeps its own favicon.
- **Pages.** On a site with more than one page, a Pages tab comes first: the site's pages, found from their links,
  and a click opens one in the editor. A site with no build step now serves clean addresses (`/security` from
  `security.html`), so links like that work in the studio as they do on the live site.
- **Assets.** A tab beside Layers and History lists the pictures and videos on the open page, with a search. A
  row picks the thing that shows that file, so its **Replace…** is one click away in Elements.
- **"update uberdesigner studio".** Say it in Claude Code to get the newest version: Claude checks GitHub, gives you
  the one command that downloads it, and puts the new editor into the site you have open.
- Fable 5.2 in the editor's model picker. A new site still starts on Opus 5.5.
- Opened in the Claude app's own browser, in a pane too narrow for it, the editor says so and offers to copy its
  link for your browser. "Continue here anyway" keeps it in the pane.
- The editor shows its legal notice and credit, at the end of the Tokens saved panel, and setup puts `LICENSE` and
  `NOTICE.md` into the site's `.inspector/tool/`.
- A README for someone deciding whether to try it, with the guides moved to `docs/`, and
  [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

### Fixed

- The studio's server could end by itself when a command it ran (git, most often) finished before reading what it
  was sent. The editor then stopped answering until the dev server was started again.

## Earlier

Everything before this file was started (13 November 2026 onwards) is in the git history.
