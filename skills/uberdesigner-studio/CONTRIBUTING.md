# Contributing to uberdesigner studio

Bug reports, ideas and code are all welcome. This page says how to send each, and what to run before you do.

## A bug, a question, an idea

Open an issue. For a bug, the three things that help most:

- what you did and what you saw, with a screenshot of the editor if it shows there;
- the kind of site (one HTML page, plain files, Vite + React) and your Node.js version (`node --version`);
- what the terminal running the site printed, if anything.

A security problem goes another way: see [SECURITY.md](SECURITY.md).

## Code

For anything larger than a fix, open an issue first, so we agree on the approach before you spend the time.

Read these two before changing anything:

- [ARCHITECTURE.md](ARCHITECTURE.md): the pieces, how a change travels through them, and the rules the code keeps.
  A change must not break one of those rules.
- [Working on uberdesigner studio](docs/development.md): what is in the folder, the stacks, and every test.

### Set up

You need Node.js 23.6 or newer (the server and the scripts run their `.ts` files as they are), pnpm, and Google
Chrome for the browser tests.

```bash
pnpm install
```

### Before you open a pull request

These are what runs on every pull request (`.github/workflows/test.yml`), so run them first:

```bash
pnpm typecheck
```

```bash
pnpm build:panel
```

```bash
pnpm test
```

```bash
node tests/browser/identity.mjs && node tests/browser/observe.mjs
```

A change to the runtime or the scripts also gets a run of the sites suite, which compares your version with `main`
on real sites. It needs test sites of your own and is run by hand:
[the sites suite](docs/development.md#before-merging-the-sites-suite).

### How we keep the repo

- **One change per pull request.** A fix and a refactor are two.
- **The built panel is committed, in a commit of its own.** `runtime/panel/` is what people's sites run. After a
  change to `runtime/panel-src/`, commit the change, then run `pnpm build:panel` and commit the result as "Panel
  build for the commit before".
- **Docs change with the code.** A change in what the studio does updates the page that describes it, in the same
  commit: [Using the editor](docs/editor.md) for what a person sees, [How it works](docs/how-it-works.md) for what
  is sent and written, [ARCHITECTURE.md](ARCHITECTURE.md) and [Internals](docs/internals.md) for the code. Something
  a person using the studio would notice also gets a line in [CHANGELOG.md](CHANGELOG.md).
- **Commit messages are plain sentences** that say what is now true: "A command that ends without reading its input
  no longer ends the server".
- **Only your own material.** Test sites, fixtures, prompts and examples must be your own work or work you have the
  right to share under this licence. Don't add other people's sites, templates or prompt packs.

## The contributor agreement

<!-- DRAFT: the agreement's text isn't written yet, and how it is signed isn't decided. This section says only what
     the README already says. -->

uberdesigner studio is under the [AGPL](LICENSE), with the term in [NOTICE.md](NOTICE.md). Before an outside
contribution is merged, we ask its author to sign a contributor agreement, so that Advanced Design Technologies Ltd.
can keep offering the studio under this licence and others.
