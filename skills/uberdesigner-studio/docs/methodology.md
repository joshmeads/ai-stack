# How we measure the savings

[← Back to the README](../README.md)

The README says uberdesigner studio uses 3 to 5× fewer tokens for a design change than asking Claude Code directly,
and that a change through it adds nothing to your conversation. This page is how we got those numbers: what was compared, how tokens were
counted, the results in full, what the test does not show, and how to run it yourself.

Measured on 18 November 2026 with Opus 5.5. It is our own estimate, on our own sites.

## What is compared

The same request, made two ways, with the same model:

- **Through the studio.** The request is made on its layer, as one call, on the site's dev server. It goes out as
  the editor sends it, with the CSS rules the open page applies to that layer. The change is undone afterwards, so
  every request starts from the same site.
- **Asking Claude Code directly.** `claude -p "<request>"` in a fresh copy of the same site, with no studio and no
  map in it, default tools and settings, skills off so the studio's own skill can't step in. Afterwards the copy is
  compared with the site, to see that something was changed.

## The sites and the requests

- **Three sites, drawn by a random generator** from our 24 mapped test sites: umbrela-hero, portale-luna and
  ui-type-animator. All three are Vite + React projects. One very heavy site was left out of the draw.
- **Five requests a site, fifteen in all, written before any result.** They are everyday design changes: a bigger
  button, a lighter headline, an outline, looser line spacing, rounder corners, smaller grey text, a slowly pulsing
  dot. The full list is [`backtest/cases-2026-11-18.json`](https://github.com/bogdan239/uberdesigner-studio/blob/benchmark/backtest/cases-2026-11-18.json) on the `benchmark` branch.
- **Each site was copied** and set up with that day's studio, so the real test sites were never touched.

## The two tests

**1. One change, in a new conversation.** Each of the fifteen requests is asked of Claude Code in a conversation of
its own, and made once through the studio. This is the person who opens Claude Code to change one thing.

**2. Five changes in one conversation.** A site's five requests are asked of Claude Code one after another in the
same conversation, three conversations in all. This is the person who keeps working in one chat. The studio side is
the same fifteen studio changes as in test 1: a studio change never depends on what came before it.

## How tokens are counted

- **The source** is the token breakdown the Claude CLI reports for each run: fresh input, cache writes, cache reads
  and output. For Claude Code asked directly we also read its own logs, and the two agreed on every run.
- **Weighted the way usage is priced.** Relative to fresh input, a cache write counts 1.25, a cache read 0.1 and
  output 5. Most of what Claude Code processes when asked directly is its own instructions read again from the cache
  on every step (93% of its raw count here), so counting raw tokens would make the saving look several times bigger
  than it is. The plans don't publish how they count usage, so pricing is the closest fair stand-in.
- **The context window** is read from Claude Code's log of the conversation: how many tokens the conversation held
  when a change began and when it ended. A studio change is a single request outside any conversation, so it adds
  nothing to one.

## Results

### Tokens per change

| | Through the studio | Asking Claude Code directly | Fewer tokens |
|---|---|---|---|
| One change in a new conversation, median | **10.8k** | **55.6k** | **5.2×** |
| The same, average | 11.7k | 59.1k | 5.0× |
| Five changes in one conversation, total per site | **58.7k** | **209.0k** | **3.6×** |

In one conversation the first change cost Claude Code about what a change in a new conversation costs (58.3k,
median), and the four after it less (37.3k, median), because it already knew the project. That is why the saving
over five changes is 3.6× and not 5.2×.

Single changes varied a lot. In test 1 they ran from 2.5× to 12.7×. The saving was smallest where the studio's own
change was large (a badge text made smaller and grey became two new design tokens in a second file: 27.5k through
the studio) and largest where the studio's call was small and Claude Code searched the project in eight steps (a
smaller wordmark: 5.0k against 63.2k).

By site, test 1:

| Site | Through the studio | Asking Claude Code directly | Fewer tokens |
|---|---|---|---|
| umbrela-hero | 10.8k | 49.8k | 4.6× |
| portale-luna | 12.8k | 64.9k | 5.1× |
| ui-type-animator | 7.0k | 51.6k | 7.3× |

Over five changes in one conversation the three sites gave 3.6×, 2.5× and 5.9×.

### The context window

| Tokens the conversation holds | Asked in the Claude Code chat | Through the studio |
|---|---|---|
| Before the first change | 37.8k | no conversation is used |
| After five changes, median | 79.2k (75.2k to 83.9k) | the same as before |
| Added by five changes | **41.4k** (37.4k to 46.1k) | **0** |
| Added by one change | 11.5k for the first, 6.6k for each one after | 0 |

Each studio change is one request of 7.6k tokens (median; 5.3k to 19.8k), 8.5k with its answer, and nothing of it
stays anywhere. Asked in the chat, a change took two to eight requests to the model, each of them reading the whole
conversation so far, and what it read and wrote stays in the conversation for the rest of it.

The 37.8k at the start is Claude Code's own instructions and tools with this computer's settings. It differs from
one computer to another; what a change adds does not depend on it.

### Time

Through the studio a change took 8 to 32 seconds; asked directly, 21 to 53 seconds in a new conversation and 14 to
56 in a running one. Several calls ran at once during the test, so both sides are slower here than they would be
alone.

## Why the numbers come out this way

**Why a change takes fewer tokens.** Asked directly, Claude Code works as an agent: it searches the project, reads
files, edits and checks, in two to eight requests to the model, and every request reads the whole conversation
again. The studio already knows which part is meant and which pieces of code belong to it, so a change is one
request of about 8k tokens holding only those pieces.

**Why a change adds nothing to a conversation.** A change through the studio is a call of its own, outside the
person's chat with Claude. It doesn't read the conversation and leaves nothing in it. That is how it is built, not
an average, so it holds for every change and for a conversation of any length.

**What does cost tokens in a conversation.** Setup, once per site, and updating the map when the site was changed
outside the studio. Both are done by Claude Code in a chat, and neither is in the results above (see below).

## What this does not show

- **Each request ran once.** A model doesn't answer the same way twice, so a single change's ratio can move.
  Medians over fifteen are steadier, but fifteen changes on three sites is still a small sample.
- **Whether a change looked right was not judged**, only that files were changed. In test 1 all thirty runs
  changed a file; in test 2 every request finished and every conversation's copy ended up changed.
- **Conversations longer than five changes were not measured.**
- **Other models, other kinds of site and bigger projects** may give other numbers. All three sites here are small
  Vite + React projects, and the sites were our own.
- **Setting a site up costs tokens once**, in a conversation, and that cost is not in these numbers: 182k tokens
  right after Claude built the site, 529k on a site built earlier, measured on two sister sites on 13 November 2026
  ([Measurements](measurements.md#when-to-set-it-up)). At 30k to 47k tokens saved per change (the averages of the
  two tests), that is paid back in roughly 4 to 6 changes in the first case and 11 to 18 in the second. How many
  tokens setup leaves in the conversation was not measured.
- **Updating the map was not measured.** When a site is changed outside the studio, Claude Code updates the map in
  a chat, and that costs tokens and stays in that conversation.

## What we say, and what we don't

- "3 to 5× fewer tokens": 3.6× over five changes in one conversation, 5.2× for a change in a new one.
- "A change adds nothing to your conversation": true of every change through the studio, because it is a separate
  call. Asked in the chat, five changes added about 41k tokens. Not "the studio never costs tokens in a chat":
  setup and map updates do.
- Not "at least" anything: single changes went as low as 2.5×.
- Not the raw token counts, which count cached tokens at full price.

## The counter in the editor

The editor's "Tokens saved" counts each change against the median for the same change asked in a new conversation,
55.6k (`BACKTEST` in `runtime/server/savings.ts`), less what the change itself used. For someone who would have
made the change in a running conversation it overstates the saving, as the results above show.

## Run it yourself

The scripts, the cases and the results are in [`backtest/`](https://github.com/bogdan239/uberdesigner-studio/tree/benchmark/backtest) on the repo's `benchmark` branch, apart from the
skill people install. Get a copy of that branch in a folder of its own:

```bash
git clone -b benchmark https://github.com/bogdan239/uberdesigner-studio studio-benchmark
```

Run the commands below from that folder. The sites' dev servers must be running with the studio
installed, and the scripts need Google Chrome and the Claude CLI, signed in. They spend tokens on your own plan:
this run used about 1.7 million weighted tokens.

```bash
node backtest/run.mjs backtest/cases-2026-11-18.json out.json
```

```bash
node backtest/summarize.mjs out.json
```

```bash
node backtest/conversation.mjs backtest/cases-2026-11-18.json conversation.json
```

The cases file has a folder and a port for each site: put your own there. Our
results are `backtest/results-2026-11-18.json` and `backtest/conversation-2026-11-18.json`.
