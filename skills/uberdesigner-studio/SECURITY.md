# Security

uberdesigner studio runs a small server on your own computer, next to your site's dev server. That server can start
Claude Code and write your site's files, so a way for someone else to reach it is a security problem, and we want to
hear about it before it is public.

## Reporting a problem

<!-- DRAFT: this needs "Private vulnerability reporting" switched on in the repository's settings when it goes
     public, or an email address here instead. -->

Please don't open a public issue. Use **Report a vulnerability** on the repository's Security tab, which sends the
report to the maintainers only. Say what you did, what happened, and which kind of site it was on (one HTML page,
plain files, Vite + React).

We'll confirm we have it, tell you what we plan to do, and credit you in the changelog when it is fixed, if you want
that.

## What counts

- A page on another website, or another program, getting the studio's server to do something: start Claude Code,
  write or read a file, read the site's token.
- The studio writing somewhere it shouldn't, or running something a site's files or a map told it to.
- Anything leaving your computer beyond what
  [What leaves your computer](README.md#what-leaves-your-computer) lists.

How the server decides who may call it is in [Who can call the studio](docs/how-it-works.md#who-can-call-the-studio),
and the rules themselves are in `runtime/server/guard.ts`.

## What doesn't

- What Claude writes into your site when you ask it for a change. That is yours to review: every change is a card you
  keep or undo, and a version in History.
- The studio hosted for other people, or opened to a network. It is made for your own computer and your own Claude
  account, and isn't protected for anything else.

## Which version

Fixes go into the newest version on `main`. To get one, update the skill, then update the studio in your site:
[updating a project](docs/how-it-works.md#setup-and-updating-a-project).
