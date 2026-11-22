// Dev-server side of the inspector (src/inspector). Nothing here ships in a build.
//
//   GET  /__inspector/editor    the editor: layers, the site in a frame at a chosen viewport size, its values
//   GET  /__inspector/status    is Claude Code installed and signed in? (`claude auth status`, no tokens spent)
//   GET  /__inspector/sizes     byte size of files the inspector may send, for its token estimate
//   POST /__inspector/save      write live token and word edits to the map's tokens file and words file
//   GET  /__inspector/tokens    the tokens file as written, for the panel's token controls
//   POST /__inspector/run       queue a change. mode "part": Claude gets only that part's prompt lines, the request and
//                               its context, no tools, and answers with find/replace edits we check and apply.
//                               mode "project": Claude Code works as an agent in the project (read, edit, write files,
//                               add packages with pnpm, typecheck), streaming its steps; it can continue a conversation.
//   GET  /__inspector/jobs      every queued, running and recent change: steps and progress so far, then the result
//   POST /__inspector/stop      stop or cancel one change (the person decides; nothing stops it on a clock)
//   POST /__inspector/observed what the panel saw on the page after a change landed (a line for its card)
//   POST /__inspector/keep      accept a change (all its tries): its card closes, its versions stay in History
//   POST /__inspector/dismiss   close a card that changed nothing (failed, stopped, undone)
//   POST /__inspector/undo      take back a change (all its tries), keeping the ones made after it (a new version)
//   POST /__inspector/undo-edit  take back one edit the inspector wrote itself (typed words, a link, a slider), by its version
//   POST /__inspector/bring-back {thread}: put a change that was taken out back on the site as it is now
//   POST /__inspector/layer      an object picked inside a layer becomes a layer of the map (layers.ts)
//   POST /__inspector/compare   show the page at one try of a change (0 = as it was before it), or back as it is
//   POST /__inspector/choose    go back to one try of a change: the tries after it are taken back (a new version)
//   POST /__inspector/text      new words typed over the page: written into the source directly when they're found
//                               exactly once in the part's files (no Claude call), else asked of Claude as a change
//   GET  /__inspector/history   every version: the start, each change, save and restore
//   GET  /__inspector/map-check is the map behind the site? (files gone, tags gone, new files, prompt changed)
//   GET  /__inspector/map       the map as it is now, and when it last changed (the editor swaps it in when that moves)
//   POST /__inspector/restore   put the project back to any version (as a new version, so nothing is lost)
//
// Parallel changes: up to MAX_PARALLEL part changes run at once (Claude thinks and writes side by side); applying,
// checking and recording each one happens one at a time under a write lock. Two changes to the same part run one after
// the other, and a Whole site change runs alone. If another change landed where an answer's edits go, that change is
// asked again once against the current file.
//
// A card is a thread: the first request and every refinement of it ("not quite, make it more like ice"), each a
// separate call that gets the earlier tries as context. The person reviews it with Before/After, then keeps it or
// undoes it (all tries at once). Cards live in .inspector/cards.json, so they survive a dev-server restart.
//
// Everything project-specific comes from inspector.map.json (written by the design-map skill): the facts Claude is
// told about where things live, the tokens file, the words file, the parts.
//
// History is a private git repository in .inspector/git (the project's own git, if any, is never touched). Claude Code
// runs with --safe-mode, so no CLAUDE.md, plugins or MCP servers are loaded: fewer tokens, and no outside rules.
//
// This file is the way in. The work is in the modules beside it, one job each:
//   site.ts            the site's folder and files: where it is, what may be edited, the map, the write helpers
//   api.ts             the /__inspector routes, the editor page and the panel's files
//   access.ts          who may call the API (guard.ts has the rule; this holds the site's token)
//   queue.ts, jobs.ts  the changes waiting, running and finished, and their cards
//   part.ts            a change to one part: what is sent, the answer applied, checked and recorded
//   project.ts         a whole-site change: Claude Code working as an agent in the project
//   claude.ts          running Claude Code and reading what it used; prompts.ts has the two system prompts
//   answer.ts          reading Claude's answer and placing its edits
//   history.ts         the private git history, the write lock, restore
//   threads.ts         a change's tries: undo, before/after, use this one, keep
//   direct-changes.ts  changes written without Claude: typed text, a link, an image, an effect's number
//   motion.ts          a transition's or an animation's timing, written into its CSS rule
//   settings.ts        effect settings that move with the code, and their history
//   save.ts            saving values from the panel; css-write.ts writes them into a stylesheet
//   map-store.ts       keeping the map in step after a write; map-check.ts says when it has fallen behind
//   estimates.ts       how long and how many tokens a change will take, learned from the ones before
// Pure text helpers shared with the setup scripts and the panel: address.ts, values.ts, slices.ts, reconcile.ts,
// text.ts, direct.ts, guard.ts, savings.ts, adapters.ts.

import { clearStaleLock } from "./history.ts";
import { loadCards } from "./queue.ts";
import { recoverCompare } from "./threads.ts";

export { markStale, useRoot } from "./site.ts";
export { isOwnWrite } from "./direct-changes.ts";
export { mapCheck, mapCheckLine, writeMapBaseline, type MapCheck } from "./map-check.ts";
export { allowRequest, apiToken } from "./access.ts";
export { handleInspector, panelTags, toStudio } from "./api.ts";

// Once, when the dev server starts (vite-plugin.ts, serve.ts): the cards waiting for review come back from disk, and a
// page left showing a change's "before" is put back to "after". Importing this file does nothing by itself, so the
// setup scripts can use its functions on any folder (useRoot) without touching that folder's state.
let started = false;
export function start() {
  if (started) return;
  started = true;
  clearStaleLock();
  loadCards();
  void recoverCompare();
}
