# inspector.map.json

The map tells the studio what the site is made of. It sits at the project root. `apply.mjs` writes it and the
studio reads it, both in the panel and on the dev server. A full example is in `example.map.json`.

```jsonc
{
  "version": 1,
  "name": "Fernhill hero",                      // shown to Claude and in the panel
  "source": {
    "prompt": "prompt.md",                       // the build prompt file in the project, or null when it lives
                                                 // elsewhere (the quotes are copied into the map either way)
    "template": null,                            // the uberdesigner template it came from, if any
    "kind": "prompt+code",                       // "prompt+code" | "code" (no prompt: descriptions come from the code)
    "artifact": "https://claude.ai/…"            // optional: the claude.ai Artifact this page was published as, so
                                                 // "publish it again" updates that link instead of making a new one
  },
  "facts": [                                     // 3–8 short lines about where things live. Every request to Claude
    "Design values are CSS variables in src/styles/tokens.css; sizes are calc(N * var(--u)) in design px.",
    "Every word on the page is in src/content.json.",               // gets them, so make them true and specific.
    "Intro and motion timings are in src/components/Page.tsx."
  ],
  "tokensFile": "src/styles/tokens.css",         // the CSS file with the :root design tokens (for a single-file site,
                                                 // index.html: its <style> blocks are read), or null
  "content": { "file": "src/content.json", "labels": { "headline1": "Line 1" } },
                                                 // only when words live in a JSON file behind src/lib/content.ts
                                                 // (live word fields in the panel). Otherwise null.
  "extraFiles": ["src/App.tsx", "src/styles/global.css", "index.html"],
                                                 // shared files changes sometimes need: automatic context adds
                                                 // their matching pieces when a request is about motion or words,
                                                 // and they're offered when files are picked by hand
  "groups": ["Header", "Hero", "Scene", "Intro"],       // panel order; "Site" (Whole site) is added automatically
  "parts": [ /* see below */ ],
  "tag": "data-dm",                              // written by apply.mjs: the attribute its tags use. A map without
                                                 // it is from before 16 Nov 2026 (data-part): apply renames its tags.
  "tokens": {                                    // every token a part lists, described once
    "--bark": { "kind": "color", "role": "Colors › bark: the preloader, text on cream",
                "label": "Bark brown" }
  }                                              // kind: color | size | em | ms | number | text; role: the
                                                 // prompt's words; label: the plain name the editor shows
                                                 // ("Body text size", not --fs-body), 2–4 words. Only tokens
                                                 // defined in tokensFile; never a component's local variables.
}
```

## A part

```jsonc
{
  "id": "menu",                                  // lowercase-with-dashes; becomes data-dm="menu" on the page.
                                                 // "site" is reserved (the studio adds Whole site itself).
  "label": "Menu",                               // what a designer calls it
  "group": "Header",                             // one of groups
  "parent": "header",                            // optional: the part it sits inside. Its layer is nested under that
                                                 // one, and its element must be inside the parent's element. Sections
                                                 // are parts too ("Hero", "Header"), parents of what's in them.
  "kind": "list",                                // optional: section | frame | text | image | video | button | icon |
                                                 // scene | list, for the layer's icon. Without it the editor reads the
                                                 // element (an <img> is an image, an <a> a button, text is text).
  "prompt": [                                    // the build prompt's own words about this part, with where they are.
    { "where": "Layout › 1. Header › Menu",          // Quote the lines that define it (size, place, colours,
      "text": "Four links 28 apart, UI style, cream at 70% opacity. The current one is full cream…" },  // states).
    { "where": "Motion › M2 · Reveals", "text": "t = 1.0: the whole row fades in, 0.5 s." }
  ],                                             // Code-only projects: "where" is the file, "text" says what it does.
  "tokens": ["--ui-size", "--cream"],                // tokens its OWN rules use (from the CSS its classes use), not
                                                 // its nested parts' tokens: picking a layer shows only these, and
                                                 // a change there applies to this layer (and what's inside it) only
  "content": ["menu"],                           // word keys it shows (only with "content" set at the top)
  "files": ["src/components/Header.tsx", "src/components/Header.module.css"],   // where it lives, for people
  "edit": ["src/components/Header.tsx", "src/components/Header.module.css", "src/styles/tokens.css"],
                                                 // the files a change to it starts from. Small ones are sent whole;
                                                 // from big ones only its pieces (markup, CSS rules, functions).
                                                 // Code/style files under src/ or index.html only.
  "note": "Hidden on phones (width < 900).",     // optional: one thing a designer should know
  "params": [                                    // optional, for effects (WebGL, canvas, JS motion): numbers in the
    { "file": "src/components/Ripple.tsx",   // code the panel shows as sliders and writes straight into the file.
      "name": "RISE", "label": "Fade in speed",  // "name": a constant (const RISE = 0.07), or "find": the code right
      "min": 0.005, "max": 0.3, "step": 0.005 }, // before a number, written once in the file ("float falloff =
    { "file": "src/components/Ripple.tsx",   // smoothstep(" for a shader's 0.56). A shader float keeps its dot.
      "find": "float falloff = smoothstep(", "label": "Ripple size", "min": 0.1, "max": 1.2 },
    { "file": "src/config.ts", "find": "copyRise: [", "nth": 1,   // "nth": a later number after the find (1 = the
      "label": "Copy rise end", "min": 0, "max": 1,            // second), so "[0.2, 0.8]" gives two settings
      "motion": true }                                         // "motion": a timing, listed under Animation timing
  ],
  "added": true,                                 // set by the studio: a part a change added ("removed": true for one
                                                 // a change removed). Kept in the map either way, and listed only
                                                 // while its data-dm tag is in the code, so Undo brings it back.
  "outline": false,                              // optional: false for parts that can't or shouldn't be outlined:
                                                 // intro-only layers, objects inside a canvas. Listed and
                                                 // changeable, never outlined; targets optional.
  "hideWhileInspecting": true,                   // optional: hide its element while the panel is open (a custom
                                                 // cursor that follows the mouse would otherwise catch every click)
  "at": 0.42,                                    // optional: where it shows on a scroll story (a layer pinned and
                                                 // revealed in turn): scroll progress 0–1, or a scroll position in px.
                                                 // Picking the layer scrolls there first; without it the editor
                                                 // searches the page (and the pinned section) and remembers the spot.
  "targets": [                                   // where the part is on the page. Usually a tag: apply.mjs writes
    { "file": "src/components/Header.tsx", "find": "className={styles.menu}" }   // data-dm="<id>" onto the JSX or HTML
  ]                                              // element whose opening tag holds "find" (exactly one element; add
                                                 // "nth": 0 to pick among several). A component tag needs
                                                 // "forwards": true, and only if it passes data-dm on to its element.
                                                 // Or an address asked of the page, for what the code can't tag (the
                                                 // element a component renders itself, markup a script writes):
                                                 // { "selector": "[data-dm='features'] h2" }. It starts from a part
                                                 // that is tagged in the code; nothing is written into the code for
                                                 // it, and the part's own values are saved under that selector. One
                                                 // element carries one part. No targets: listed for its values only.
}
```

## Layers, like a design file

Parts nest the way a designer's layers do, with `parent`:

- **Each section is a part** (the hero, the header, the footer), on the section's own element, with the tokens its own
  rule uses: its background, its padding or page edge. Everything in the section has it as `parent`.
- **A part with separate pieces gets a child part per piece**: a name set as two words, each styled on its own, a row
  with a kicker and a spec line, a button's label and its icon. Each child is tagged on its own element.
- **List only a layer's own tokens.** A section lists its background and spacing, not its headline's text size; the
  headline lists its own. Picking a layer shows only its tokens, and a change there is saved for that layer only (a
  `[data-dm="…"]` rule in the tokens file, or a rule under the layer's selector, that wins over the site-wide value
  for that layer and what's inside it).
  Site-wide values are changed under Whole site.
- **Maps without `parent`** still work: the editor lists them flat under their group folders.

## Good parts

- **Name what a designer sees, not how it's built.** Use "Tab bar", "Headline", "Stat cards", not "NavLinks" or
  "Section2Wrapper".
- **Make each part a thing someone would ask to change on its own.** Group repeated items into one part ("Stat cards"
  with one target per card, or one target on their shared wrapper).
- **Give every visible area a part.** Background layers that cover the screen are parts too, with `outline: false` if
  outlining them would only get in the way. The smallest outlined part under the mouse wins, so a full-screen
  background part only catches clicks where nothing else is.
- **Never stack two outlined parts of the same size.** The smallest outlined part under the mouse wins a click, so a
  full-screen background part only catches clicks where nothing else is, and of two full-screen parts only one can
  be clicked. Give the second one `outline: false`. The exception is a nested part the size of its parent (a section's
  full-size photo): the nested one wins the click, and the section is picked from the layers.
- **Canvas scenes: tag one, list the rest.** One tagged `scene` part on the canvas or its host, plus `outline: false`
  parts for the objects inside it (sphere, book, sky) that people will ask to change, each with the scene code in
  `edit`.
- **Keep the `edit` lists tight.** Each part's own component and style files, the tokens file when its tokens live
  there, and the words file when its words live there. Leave large shared files (the page's timeline, shaders) for
  `extraFiles`, or add them only to the parts that are mostly defined there.
- **Write the facts as orientation for someone who has never seen the project.** Where the tokens, the words, the
  motion timings and any unusual systems (WebGL, canvas, three.js) live. Also any trap, for example "brand colours set
  from CONTENT.vars in main.tsx override tokens.css". The studio shows tokens set from code with their live value,
  but saving can only write the tokens file, so the fact tells Claude where to change them.
