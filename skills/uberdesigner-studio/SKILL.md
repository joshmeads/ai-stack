---
name: uberdesigner-studio
description: Map a website's parts (from its build prompt, its code, or both) and install uberdesigner studio, a localhost panel where each part can be inspected, tweaked live, and changed by Claude one part at a time, with history and restore. Use when someone wants to set up uberdesigner studio (earlier called the design inspector or "design map") on a Vite + React project or a site with no build step (an HTML page with inline CSS and JS of any name, as Claude Code and AI site builders make by default; plain HTML, CSS and JS files; such a site with its own small Node server; or a page made as a claude.ai Artifact), an uberdesigner template, or their own code, to update an existing map after the site changed, or to update uberdesigner studio itself to its newest version. Also use it right after you finish building a website from a build prompt in this conversation: offer the studio in your hand-over, since that's the cheapest moment to set it up.
---

# uberdesigner studio

This skill turns a website into an inspectable one. It works with two kinds of project:
- **Vite + React + TypeScript**: the studio plugs into Vite's dev server.
- **No build step**: an HTML page with inline CSS and JS (any name: `index.html`, `coffee-shop.html`), or plain HTML,
  CSS and JS files, at the top of the folder or in `public/`, and no build tool in a `package.json`. This is what
  Claude Code makes when someone asks for "a website" without naming a stack. The studio runs from its own small
  server, and the site's files only get `data-dm` tags. A site with its **own small server** (a `server.js` that
  saves a form, or a package.json `start` script) keeps it: the studio starts it and stands in front of it.

**Any other stack isn't supported yet** (Next.js, Astro, Nuxt, SvelteKit, Remix, Vite with Vue or Svelte, webpack…). The
scripts check this first: `index.mjs`, `apply.mjs` and `verify.mjs` stop with "Not supported yet: …" and change nothing
in the site. When you see that line, tell the person plainly which stack was found and that it isn't supported yet.
Don't work around it (no hand-made map, no editing the scripts' checks, no `DESIGN_MAP_FORCE`, which is for people
building a new connector).

It writes a **map** of the site's parts
(`inspector.map.json`): what each part is, what the build prompt says about it, the tokens that style it, and the
files it lives in. It then installs **uberdesigner studio**, a Figma-like editor on localhost (the site's address opens in it). There you click a part,
see its prompt lines and tokens, tweak them live, and ask Claude to change just that part. Each change sends only that
part's lines and files, so it's a few thousand tokens instead of a whole chat.

The map is made once per project. Scripts do everything with a fixed format and spend no tokens; you do only the
matching, in step 3.

Scripts live in `scripts/` next to this file. Run them with Node from anywhere; `<project>` is the site's folder. Everything needs
Node 23.6 or newer: step 0 makes sure it's there, and names the Node to use. For React projects the scripts borrow TypeScript from the project, so its packages must be
installed; plain HTML sites need nothing installed. **New Vite projects pin TypeScript 7**, which has no JS API: if a
script says the project uses TypeScript 7, ask the person once ("this project uses TypeScript 7; I'll install
TypeScript 5 for the skill, once for this computer, about 20 MB, into the skill's own `.typescript/` folder"), then run
the exact command the script printed and the script again. Never install it without asking. Any TypeScript 5 folder
also works: `DESIGN_MAP_TS=/path/to/node_modules/typescript`.
Work files go to `<project>/.inspector/map-work/`, so runs on different projects never collide.

## 0. Get the computer ready, first: you explain, they do each step

uberdesigner studio needs two things on the person's computer, settled in this order:
1. **Claude Code in the terminal, logged in.** The studio's changes run it, on their own Claude account. The desktop
   app and IDEs keep their own copy, which doesn't count.
2. **Node.js.** It runs the studio's small local server and the skill's scripts (23.6 or newer for now).

Claude Code comes first because people are at ease doing something with Claude; Node.js comes second. Settle both here
in the chat, before indexing or mapping, so nothing is spent on a studio that can't run yet.

**Two rules.** Tell them what will happen and why before every step. And **they do each step themselves**: you never
install anything or log in for them, because it's their account and their computer. The only command or link in your
messages is the one for their step (a command in its own `bash` block). Your own checks stay out of your words, and
each gets the plain description below (the app shows it on the step's row).

1. **Check** (description: "Check what uberdesigner studio needs on this computer"): `sh scripts/setup-check.sh`. It needs
   nothing installed. `READY` → say nothing about it and go on with setup, running the skill's scripts with the Node
   it names (`<that path> scripts/index.mjs …` when it isn't plain `node`). Otherwise it prints `STEPS` (what's left,
   in order), `NEXT` (the step now) and `PERSON RUNS <command>`: give exactly that command.
2. **Say what's coming, once, at the start**, in one or two short sentences from `STEPS`, then give the first step.
   Number the steps when there's more than one ("Step 1 of 3").

   **Keep it short.** Long text stresses people, and they read only the step anyway. A step is: the bold line, one
   short sentence (two for Node.js, which most people have never heard of), the line on how to start the command, the
   command, one short line after. Nothing else.

   **Every step stands on its own.** Many people are new to all of this: a bare "install Claude Code" surprises
   someone who is talking to Claude right now ("isn't it installed here already?"), and "install Node.js" means
   nothing to someone who has never heard of it. So the bold line itself names the place or the thing ("for your
   terminal", "in your terminal", "a free program uberdesigner studio runs on"), in every step, the later ones too. Name
   where they are: "this app" in the desktop app, "this extension" in an IDE; in a terminal session, leave that
   sentence out.

   **Say how to start the command, right before it.** A new person doesn't know a command in the chat can be run
   from the chat. Say ▶, not "Run": the button is an icon, and the word isn't on it.
   - Claude desktop app: "Press the ▶ button at the right of the command to start it:" in the first step, then
     "Press ▶ on the command:".
   - Terminal session: "Type `!` and then the command, in this chat:".
   - IDE: "Paste the command into your editor's terminal:".

   Pasting it into the Terminal app works anywhere: say so only when they can't find the button or it didn't work.

   The whole message when `STEPS` is `install-claude log-in install-node`, in the desktop app (with fewer steps, the
   same words with the numbers changed; the later steps come one at a time, as each is done):
   > uberdesigner studio needs two things on your computer: Claude Code in your terminal, and Node.js. Three short steps,
   > and you do each one yourself.
   >
   > **Step 1 of 3: install Claude Code for your terminal.** It's separate from this app, and the studio works
   > through it. Press the ▶ button at the right of the command to start it:
   > ```bash
   > <the command the check printed after PERSON RUNS>
   > ```
   > Anthropic's official installer, about a minute. I'll notice when it's done.

   > **Step 2 of 3: log in to Claude Code in your terminal.** It's a separate login from this app. Press ▶ on the
   > command:
   > ```bash
   > claude auth login
   > ```
   > Your browser opens: click **Authorize**.

   > **Step 3 of 3: install Node.js, a free program uberdesigner studio runs on.** It's a standard tool that most web
   > tools need on a computer. You never open it yourself: it works in the background. Press ▶ on the command:
   > ```bash
   > sh ~/.claude/skills/uberdesigner-studio/scripts/install-node.sh
   > ```
   > The official Node.js from nodejs.org. No password, about a minute.

   The commands are the ones the check printed, word for word, not these (step 1's is left for the check to give). For `update-node` the bold line is "**update Node.js, a
   free program uberdesigner studio runs on.**" and "Yours is too old for it (version <the version>)." in place of the two
   sentences. If the Node.js command says it couldn't, the nodejs.org installer (nodejs.org/en/download, the LTS
   version) is the way instead. More than this (what Node.js is for, why the terminal copy is a different one) only when they ask.
3. **Wait without asking** (description: "Wait for this step to be done"): right after your message, run
   `sh scripts/setup-check.sh --wait 600` in the background. It returns as soon as the step is done (or it shows a
   different problem), spends no tokens, and you carry on by yourself: "Step 1 of 2 done." and the next step, in its
   words from above, until
   `READY`; then "All set. Now setting up uberdesigner studio…" If they say it's done first, run the check once. If it
   times out, ask how it went (no browser page, an error, the installer didn't open).

If they'd rather not do the Claude Code steps now, go on once Node.js is there: values, words and History work without
Claude Code, changes by Claude wait, and the panel shows a short reminder that sends them back here ("connect the
uberdesigner studio to Claude Code"). Without Node.js nothing runs, so say that plainly. Someone paying per token instead
of a Claude plan logs in with `claude auth login --console`; offer it only when they ask. It's for their own computer:
never set it up to run other people's requests through one account.

## Right after a build: the short path

Use this when **you built the site in this conversation** and the build prompt and the code you wrote are still in your
context (not lost to compaction). Setting up now costs a fraction of doing it later, because nothing has to be read
again. Turns are what cost most (each one re-reads the conversation), so aim for about five tool calls.

1. **Offer it** at the end of your build hand-over, in one line, for example: "I can also set up uberdesigner studio
   now: a one-time cost, then each change to a part is a ~3–4k-token call from a panel in the browser, through Claude
   Code on your computer (I'll check your computer is ready first)." Set it up only if they say yes, or if they asked for it up
   front. It runs on their Claude account. **On a yes, do step 0 first**, then go on.
   **If you made the page as a claude.ai Artifact** (the file is in your scratchpad or another temporary folder), it
   needs a real folder first: ask where to keep the site (suggest a new folder named after it in their home or
   projects folder) and copy the page there unchanged, keeping its name, plus any files it loads. Put the Artifact's
   link in the map's `source.artifact`. Use that folder as `<project>` from here on.
2. **Index**, in one call: `node scripts/index.mjs <project>` (add `--prompt <file>` if the prompt is a file other than
   `prompt.md` in the project), then read the index it writes. Don't run read-prompt and don't reopen the files you
   wrote: you know the prompt and the code. When there's a prompt file, the index lists its section paths under
   `prompt.sections`, exactly as verify checks them.
3. **Write the map** in one call, following step 3's rules (below). You don't need to open the format reference: this
   shape is enough, with every field shown.
   ```json
   {
     "version": 1, "name": "Site name",
     "source": { "prompt": "prompt.md", "kind": "prompt+code" },
     "facts": ["Design values are CSS variables in src/styles/tokens.css.", "Motion lives in …"],
     "tokensFile": "src/styles/tokens.css", "content": null, "extraFiles": ["src/App.tsx"],
     "groups": ["Hero", "Navigation"],
     "parts": [{
       "id": "hero", "label": "Hero", "group": "Hero", "kind": "section",
       "prompt": [{ "where": "Layout › 3. Hero", "text": "the lines about the section itself" }],
       "tokens": ["--bg", "--edge"], "files": ["src/components/Hero.tsx"],
       "edit": ["src/components/Hero.tsx", "src/components/Hero.module.css", "src/styles/tokens.css"],
       "targets": [{ "file": "src/components/Hero.tsx", "find": "className={styles.hero}" }]
     }, {
       "id": "hero-headline", "label": "Hero headline", "group": "Hero", "parent": "hero",
       "prompt": [{ "where": "Layout › 3. Hero › Title block", "text": "the lines that define it" }],
       "tokens": ["--ink", "--fs-title"], "files": ["src/components/Hero.tsx"],
       "edit": ["src/components/Hero.tsx", "src/components/Hero.module.css", "src/styles/tokens.css"],
       "targets": [{ "file": "src/components/Hero.tsx", "find": "className={styles.titleBlock}" }]
     }],
     "tokens": { "--ink": { "kind": "color", "role": "Colors › ink: headline and body text", "label": "Text colour" } }
   }
   ```
   Parts nest like a designer's layers (step 3, "Nest the layers"): each section is a part, the parts in it have it as
   `parent`, and a part with separate pieces (two words, a kicker and a spec) gets a child part for each. A part's
   `tokens` are only those its own rules use. Optional on a part: `"kind"` (section, frame, text, image, video, button,
   icon, scene, list; the editor guesses from the element otherwise), `"note"`, `"outline": false` (objects in a
   canvas, layers that only exist during an intro; such a part needs no `targets`), `"hideWhileInspecting": true` (a
   custom cursor), `"at"` (where a part shows on a scroll story, as scroll progress 0–1 or px), `"nth"` / `"forwards": true` on a target, and a `{ "selector" }` target for an element the code can't tag (below). Token `kind` is one of `color`, `size`, `number`,
   `em`, `ms`, `text` (the index gives each). Leave out the base unit nearly every rule uses (`--u`, `--n`) unless a
   part is about scale. Each `where` is a path from `prompt.sections`. If the prompt was pasted (no file), use its own headings and set `source.prompt` to `null`.
   **A component that renders the element itself** (a `<SplitTitle>` that draws its own `<h2>`) can't be tagged from
   outside: give the part a selector target instead, starting from the tagged part it sits in:
   `"targets": [{ "selector": "[data-dm='features'] h2" }]`. Nothing is written into the code for it; the studio
   finds the element on the page. The same goes for markup a script or a generator writes.
4. **Apply and verify** in one call: `node scripts/apply.mjs <project> <map> && node scripts/verify.mjs <project>`.
5. **Fix** only what verify reports as an error, and re-run that one call. Look at the page only if a browser is
   already open or verify warns about something only the page can show (component tags, `display: contents`).
   Otherwise ask the person to open the link and check the outlines.
6. **Hand over** as in step 6 (with any `TELL` lines from verify settled first, as in step 0), in a few lines, with the parts table (label, group, element) in place of step 3's
   pause before applying: the person can rename or regroup parts afterwards, and running the map again costs little.
   The message ends as step 6 says: "Open it full screen in your browser", and the link in its own block.

Everything else (a site built elsewhere or earlier, or a build whose prompt is no longer in your context) takes the
full steps below, starting with step 0.

## 1. Index the code

```
node scripts/index.mjs <project>
```

The index lists:
- files and sizes, and the README if there is one;
- design tokens: every plain `:root` block merged with the last one winning, and phone overrides apart;
- **runtime overrides**: tokens the site's code sets with `setProperty`, which win over the CSS file;
- every component's meaningful JSX elements: tag, classes, visible text, existing `data-dm` tag. Components and elements
  created in code (`createElement`, canvases) are marked;
- the design tokens each CSS rule uses, with local variables listed apart. **Only names in the tokens file are
  tokens.**
- the likeliest word files.

Read the whole index; it's usually 3–8k tokens.

## 2. Read the prompt (skip this when there's none)

```
node scripts/read-prompt.mjs <prompt.md> --project <project>
node scripts/read-prompt.mjs <prompt.md> --section "3. Hero" [--prose]   # one section in full; --prose drops code
```

The summary lists each section's path, size and code share, and flags sections that are `large`. Tables are listed
one by one with all their columns. Bold-labelled paragraphs ("**Typography.**", "- **Headline**: …") become
subsections with real paths you can quote ("Layout › 3. Hero › Title block").

What to read, within about **15k characters of prompt** in all:
- **Layout sections**, when there are any (uberdesigner prompts describe the page part by part there). Read them in
  full.
- **When there's no Layout** (`"layout"` in the summary says so), read **Goal** and the descriptive sections whose
  names are parts of the page ("The overlay", "How the look sits").
- **Motion blocks** (M1, M2…) that name a part. Use `--prose` on long ones.
- **Design tokens**: the tables, for the token roles.
- **Skip** sections flagged `large` that are code or content ("The files", "The pictures and the content", a 141 KB
  "The scene"). If you need the prose inside one, use `--prose`.

## 3. Match: write the map

Write `<project>/.inspector/map-work/map.json` in the format of `reference/map-format.md`;
`reference/example.map.json` is a complete example. This is the one step that takes judgment.

**Find the parts.** Use the prompt's Layout sections, or the page's visible pieces. One Layout section can become
several parts: a hero with a headline, a lead and buttons is three parts. Prefer the element a designer points at over
a full-screen wrapper (`inset: 0`), which would outline the whole screen.

**Nest the layers.** The editor shows parts as layers, like a design file, and a designer picks a section to change
its background or spacing, then a text inside it to change only that text:
- **Each section is a part** (hero, header, footer, a block of the page), tagged on the section's own element, with
  `"kind": "section"`. Every part inside it gets `"parent"` set to the section's id. (In the editor the page has
  the last word: a part is listed inside the nearest part its element sits in. `parent` is what the server tells
  Claude, and what the list uses for a part with no element on the page.)
- **A part made of separate pieces gets a child part per piece**, each tagged on its own element: a name set as two
  words (first name and surname, each styled on its own), a row with a kicker and a spec line, a button's label and its arrow. Use `nth` when
  the pieces share a class. Skip pieces nobody would change on their own (one letter, a line break).
- A nested part's element must sit inside its parent's element on the page.
- **Effects get `params`**: for a WebGL, canvas or JS-driven effect, list the numbers a designer would tune (size,
  strength, speed, glow) as `params`, each a constant by `name` or the number after a unique `find` in a shader,
  with a plain `label` and a `min`/`max` range. verify checks each finds exactly one number. For a later number after
  the same find (the 0.8 of `[0.2, 0.8]`) add `"nth": 1`; a setting that is a timing (a duration, a delay, a move's
  distance) gets `"motion": true` and shows under Animation timing. Motion written as plain CSS (a transition's or an
  animation's duration in a rule) needs nothing in the map: the editor reads it from the page and saves it into its rule.
- Links, images and videos need nothing in the map: the panel reads them from the element (a Link field, Replace…).

**Find each part on the page.** Take its element from the index (a JSX element, or an HTML tag in a plain site) and
write a `target` whose `find` matches exactly one opening tag; for HTML, a piece of the tag such as `class="ticket"`. Watch for these cases:
- **A component** (`<SplitTitle>`, `<Canvas>`): a tag on it only reaches the page if the component passes it on, and
  `apply` refuses it. Use a **selector target** for the element it renders:
  `{ "selector": "[data-dm='<the tagged part around it>'] h2" }`. The selector starts from a part that is tagged in the
  code (never from one that is itself found by a selector), must match only that part's element(s), and is what the
  part's own values are saved under, so keep it short and stable (a tag name or a class the component always writes,
  not `:nth-child` of a list that changes). `"forwards": true` on a `{ file, find }` target is the other way, only when
  you opened the component and saw it spread its props onto its element; if it doesn't, the editor marks the layer
  "not on page" and says why.
- **Elements created in code** (`createElement`, headings built by a helper, markup from a template or a script) have
  no tag in the source: a selector target, as above. Tag the nearest JSX or HTML element around them as its own part
  first, so the selector has somewhere to start.
- **The site's own `data-part`** (or any other attribute its scripts read) doesn't matter: the studio's tag is
  `data-dm`, both can sit on one element, and `apply` never touches the site's.
- **`display: contents` wrappers** have no box, so tag a child instead. Hidden helper elements (`visibility: hidden`,
  probes) and elements at opacity 0 aren't outlined either.
- **3D/WebGL objects** (inside a `<canvas>` or `<Canvas>`) can't be outlined. Make one tagged `scene` part on the
  canvas or its host. Then list the objects people will ask about (the book, the sphere, the sky) as their own parts
  with `"outline": false`, pointing at the scene code in `edit`. They show in the list and can be changed, just not
  clicked on the page.
- **A custom cursor** that follows the mouse: set `"hideWhileInspecting": true`, or it catches every click.
- **Phone copies.** Some sites show a separate element on phones (`.m-script` next to `.script`, `.title-mobile`).
  Give that part a target for each copy, and say so in a fact. Otherwise a change reaches one layout only. verify warns
  about untagged copies in HTML.
- **Layers that stay in the page while hidden** (sections faded character by character, stacked screens) are outlined
  only where they show: picking one elsewhere draws a dashed box with the reason, and the editor scrolls to find
  where it shows (through a pinned section if needed) and remembers the spot. On a long scroll story where the search
  is slow or lands wrong, set `"at"` on the part: scroll progress 0–1, or a scroll position in px. Note it in the
  part's `note` too.

**Quote its prompt lines.** Take the lines that define the part (size, place, colour, states) and its Motion lines,
each with a `where` that's a real section or subsection path from the summary. For code-only sites, `where` is the
file, and the text says what the part is and does in a designer's words.

**List its tokens and files.**
- Tokens are the design tokens its **own** CSS rules use, from the index's `rules`; never local variables, and never
  its nested parts' tokens (a section lists its background and edge spacing, not its headline's size). Picking a
  layer shows only its tokens, and a change there is saved for that layer alone. Describe every
  token you list in the map's `tokens`, with the role from the prompt's tables and a `label`: the plain name a
  designer would use, two to four words ("Body text size", "Headline font", "Pill side padding", "Page edge", "Accent
  orange"). The editor shows it instead of the code name, so every token needs one: verify fails without it. When
  you update an older map, add any missing labels.
- Its `edit` files are its own component and style files, plus the tokens file when its tokens live there.
- A change sends small edit files whole and only the part's pieces of big ones (its markup, CSS rules and functions),
  so a big file in `edit` is fine when the part lives there. Shared files that only some requests need (a words module,
  the page timeline, scene code) go in `extraFiles`: requests about motion or wording reach them automatically. verify
  reports what a typical change sends and warns when a part still sends over about 8k tokens of code.

**Write the facts.** 3–8 lines: where the tokens, the words and the motion live, and every trap. For a single-file
site, name the script's main functions and modes (what places the scene, what switches screens, where data arrays
live), since Claude sees the whole file and needs to know where to look in it. In particular, if the
index lists runtime overrides, say which tokens the code sets and in which file. The panel shows those values but
can't save them to the tokens file.

**Code-only sites.** The index alone won't tell you what the parts mean. Read the README, the entry file, and the page
or timeline component first, then only the components you need; about 30–50k characters is normal. Name parts after
what's visible, not after the components.

Before applying the map, show the person the parts list (label, group, element) in a short table. Ask them only if a
part is genuinely ambiguous; otherwise continue.

## 4. Apply

```
node scripts/apply.mjs <project> <project>/.inspector/map-work/map.json [--dry-run]
```

This tags each `{ file, find }` target with `data-dm="<id>"`, the studio's own attribute, and removes the tags the
map no longer asks for (an element that still carries a part's old id, after a split or rename, is re-tagged). It
writes nothing for a `{ selector }` target. The site's own attributes are never read or changed. A map made before
16 Nov 2026 has `data-part` tags: apply renames them to `data-dm` once, with the rules saved or written for them (if
the site's own code uses `data-part` too, the old tags stay and the new ones go next to them; apply says which it
did; if verify later reports old tags again, because a History version from before the rename was restored, run apply
with `--rename-old-tags`). It refuses duplicate targets, a selector that could break a stylesheet or starts from a part that isn't tagged,
component targets that don't say `forwards`, and the reserved id `site`. It installs the studio in
`.inspector/tool/` (the same for every stack), creates or updates `.gitignore` for `.inspector/`, and writes
`inspector.map.json`.
- **Vite**: it adds a few lines to `vite.config` that load the studio's plugin from `.inspector/tool/` when it's
  there (dev server only; builds and fresh clones don't need it). Start with `pnpm dev`.
- **No build step**: nothing else in the site changes. Start with `node .inspector/tool/server/serve.ts` from the
  site's folder (port 5310, `--port` to change). It serves the site (`/` is the first page, whatever its name), adds
  the panel to every page, and updates styles live (anything else gets a Reload button, never a forced reload). A site
  with its own server: that server is started on a free port behind the studio and restarted when its code
  changes, so its forms and routes keep working. An Artifact page is sent with the doctype and `<head>` claude.ai adds
  when it publishes, and with a stand-in `window.claude` that answers "not available here", so the page draws; its
  claude.ai features (shared data, sign-in) only work once it's published again.

Running it again is safe, and it's also how a project gets studio updates. It also removes the earlier layout
(`src/inspector/`, `vite.inspector.ts`, a mount line in the entry file) if it finds it.

## 5. Verify, then look

```
node scripts/verify.mjs <project>
```

Errors: missing files or tokens, parts not tagged, tokens listed but not described, the studio not installed or
not wired, typecheck failures (for plain HTML sites, scripts that don't parse). It also reports what a typical change
sends. Warnings: things that pass the code check but may not show on the page, such as component tags,
`display: contents`, unexplained runtime overrides, parts that still send a lot after slicing, quotes whose `where`
isn't a section, cursors, and leftovers of the old layout. Fix the errors; deal with each warning or say why it's fine.

**A pass means the map matches the code, not that the outlines are right.** Start the dev server, open the site, press
**I**, and check that every outlined part frames what its label names. A layer marked "not on page" has a tag or a
selector the page doesn't answer: pick it and the editor says why (a component that doesn't pass the tag on needs a
selector target). If you can take a screenshot, take one with the outlines showing and give
it to the person.

## 6. Hand over

Tell the person, in plain words:
- what the studio is (the link that opens it now ends the message, below; for another day, when the site isn't
  running, the start command: `pnpm dev`, or `node .inspector/tool/server/serve.ts` for a site with no build step;
  then the same link: the site's address opens in the studio): it's an editor laid out like Figma, layers on the left, the site in the middle at a
  phone, tablet, desktop or large size, and on the right two tabs: **Elements** (the picked part's values and the
  global tokens) and **AI changes** (the change cards);
- that a click picks the block under the pointer (a card, a headline, a picture; a section on its empty space), a
  double-click goes inside it to the part under the pointer, and Escape goes back up; everything on the page can be
  picked this way or from its row in the list, whether the map lists it or not, and something the map doesn't list
  becomes a layer when they change it or press **Keep as layer**;
- that **Preview ▶** (or holding Option) uses the site as a visitor would (hover effects only work there), and that
  a double-click on words types over them: saved straight into the file when they're written out once in the part's
  source, else sent to Claude as a change;
- that a part's change is one small Claude call, typed in the chat bar under the site: it picks what to send by itself
  and shows it, with a time estimate (click the estimate to see or pick the files), and with nothing picked (or the
  chip's ×) the change is for the whole site;
- that each change is a card in **AI changes** (starting one opens that tab; a dot on it means something is running
  or waiting for them): it runs side by side with others (up to three); **‹ ›** steps through the original and
  every try on the live page, **Use this one** goes back to one of them, **"Not quite?"** refines it with the earlier
  tries as context, and **Keep** or **Undo** settles it (Undo takes back all its tries); changed parts stay marked in
  green until then. A settled card rests in **Resolved**, where a kept change can still be undone and one that is
  out of the page brought back;
- that **History** lists points to go back to (each save, where a session started, before a whole-site change) and
  puts the whole site back as it was at one;
- that a finished card can be clicked anywhere to jump to its part;
- that if the site changes outside the studio (new sections, removed parts), the editor says "The map is behind the
  site" and the fix is to ask Claude Code to update the uberdesigner studio map.

Also tell them which parts can't be clicked (objects in a 3D scene) and which tokens are set by the site's code.

**End the message with the link, alone in a block they can copy.** The studio is a three-column editor: in the
small preview beside the chat it's cramped, and a new person doesn't know the site has an address they can open
anywhere. So the last lines of the hand-over, after everything else, are always these (nothing comes after the link):

> **Open it full screen in your browser.** Copy this link and paste it into your browser: your site opens in the
> studio.
> ```text
> http://localhost:5310
> ```

- Name the button and its corner every time: a new person doesn't go looking for a small pill on the page, and a
  key to press is easy to miss.
- The link has to work when they paste it: have the site's server running before you write the message (start it if
  it isn't, and leave it running), and give the address it printed, with its real port, never a guess.
- A plain `text` block, not `bash`: the app puts a copy button on it, and a `bash` block would get a ▶ that runs the
  link as a command.
- If verify printed `TELL` lines and Claude Code isn't connected yet, the link still ends the message: the offer to
  connect comes before it.

**A page that came from a claude.ai Artifact** (the map has `source.artifact`): say that changes made in the studio
stay in the folder until the page is published again, and that asking you to "publish the site again" updates the same
link. When they ask, publish the page file in their folder with the Artifact tool, passing `source.artifact` as the
`url` (with a different file path and no `url` it would become a new link). Say too that its claude.ai features
(saving replies, sign-in) show as unavailable on localhost and work again on the published page.

Claude Code should already be connected from step 0. **If verify printed `TELL` lines** (they put it off, or the
sign-in has run out), offer to connect it now, before the rest of the hand-over, exactly as in step 0: explain, give
them the step to do themselves, wait. The panel shows the same reminder and turns ready by itself once they're signed in.

## Updating uberdesigner studio

This copy is vendored by ai-stack, so `<skill>` lives inside the ai-stack checkout and step 1 would find it installed another way. In place of steps 1 and 2, give the person `ai-stack skills update uberdesigner-studio` to run in their terminal, wait for them to say it ran, tell them what is new from `CHANGELOG.md`, run step 0's check, then go to step 3.

When someone asks to "update uberdesigner studio" (or the studio, or the skill), they mean its newest version. "Update
the map" is the next section. There are two copies to update: the skill (this file's folder, called `<skill>` here) and
the editor each site has in `.inspector/tool/`, which stays as it was until it's applied again. The rules of step 0
hold: the person runs the command that brings the new version, and your checks stay out of your words.

1. **Check the skill's folder** (description: "Check uberdesigner studio for a newer version"): `git -C <skill>
   rev-parse --show-toplevel`, `git -C <skill> status --porcelain`, then `git -C <skill> fetch --quiet` and
   `git -C <skill> rev-list --count HEAD..@{u}`.
   - Not a git folder, or the top folder git names isn't the skill's own (its real path, links followed): it was
     installed another way, so it can't update like this. Say so and point them at the install command in the README.
   - Files changed in it: say that the folder has their own changes (name the files), and stop. Pulling would mix them
     with the new version.
   - `0`: the skill is already the newest. Say so in a line and go to 3.
2. **They get the new version.** Say in a sentence that this downloads the newest uberdesigner studio from GitHub
   into the skill's folder, then give the one command, with the folder's real path:
   ```bash
   git -C <skill> pull --ff-only
   ```
   Wait for them to say it ran, then check the folder's commit moved. Tell them what's new in a line or two, from the
   changelog entries the pull added (`git -C <skill> diff <old commit> HEAD -- CHANGELOG.md`), in the person's words,
   not the commit messages. Then run step 0's check (`sh scripts/setup-check.sh`) again, since a new version can need
   a newer Node, and settle what it reports as in step 0.
3. **Put the new editor into the site**, if the conversation is in a site that has `inspector.map.json`. (With no
   site open, end here: say that each site gets the new editor when they say "update uberdesigner studio" in its
   folder.)
   - First read the map check: with the site's server running (start it if it isn't, as in step 6), `curl -s localhost:<port>/__inspector/map-check`. If it
     says `"behind": true`, the map is behind: tell them what it lists, and update the map (next section) instead of
     applying the old one again. Applying writes the map again, which clears that note without fixing it.
   - Otherwise: `node scripts/apply.mjs <project> <project>/inspector.map.json && node scripts/verify.mjs <project>`,
     with the Node that step 0's check names. It replaces only `.inspector/tool/`: the map, the tags, History and the
     change cards stay as they are.
   - The running server still has the old editor. If you started it, stop it by its process id and start it again.
     If they did, ask them to stop it (Ctrl+C in its terminal) and start it again with the start command.
   - End with the link to open, alone in a `text` block as in step 6. A tab opened before the restart needs a reload.

## Updating a map

When the site has changed (new sections, renamed components), run steps 1–5 again, starting from the current
`inspector.map.json` (copy it to `.inspector/map-work/map.json` and edit it there). Keep the ids that still fit, so
the person's habits and history labels stay meaningful.

The studio tells you what fell behind: `curl -s localhost:<port>/__inspector/map-check` while the dev server runs
(or the line it printed when it started) lists the files that are gone, the parts whose tag left the code, and the
new page files no part covers. Start from that list: give new files a part (or say why they don't need one), point
parts at renamed files, and drop parts that are gone. apply.mjs takes a fresh baseline when it writes the map, so the
note clears once the map is updated.

Changes made from the studio keep the map in step on their own. After every change, Undo, History restore or
Whole site run, the studio works out from the code what the code can tell: a token newly defined in the tokens file
gets a description (Claude names it; else it's named from the code), each affected layer's token list follows its CSS
(what its rules started using joins it, what they stopped using leaves), and a removed layer whose tag is back is listed
again. A change that adds something tags it and adds a part with `"added": true` under its parent; Delete layer (and any change that removes a tagged element) marks the part
`"removed": true` instead of dropping it, so Undo or a History restore brings the layer back with its tag. When you
update a map, keep those entries; give an added part proper prompt lines and tokens and clear `"added"`, and drop a
`"removed"` part only if its tag is gone for good.
