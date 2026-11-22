// A change as the inspector keeps it (a job): what was asked, how it's going, what came back. And the list of them.

import type { ChildProcess } from "node:child_process";

// weighted: the tokens counted the way usage is priced (savings.ts WEIGHT), what the savings counter uses
export type Usage = { input: number; output: number; costUsd: number; seconds: number; turns?: number; weighted?: number };
export type Mode = "part" | "project";

export type Entry = {
  id: string;
  sha: string;
  time: string;
  kind: "start" | "change" | "save" | "restore" | "undo" | "redo" | "outside" | "direct" | "pick"; // direct: written by the inspector itself, no Claude call; pick: Use this one; redo: Bring back
  label: string;
  mode?: Mode;
  partId?: string; // part changes: the part, so the panel can mark it as changed
  // What is in the page at this version: the ids of the versions whose change it holds (Claude's changes and the
  // inspector's own edits). Written once, with the version, and never edited: a change adds itself, Undo takes one
  // out, Bring back puts it in again, a restore copies the list of the version it goes back to. Whether a change is
  // in the page now is read from the newest version's list (history.ts), never from a flag kept beside it.
  contains?: string[];
  point?: string; // why History lists this version as a point to go back to (a save, where a session started, …)
  undoneBy?: string; // histories from before "contains": the version that took this change back
  request?: string;
  summary?: string;
  usage?: Usage;
  files: string[];
};

export type Job = {
  id: string;
  mode: Mode;
  part: string;
  request: string;
  state: "queued" | "running" | "done" | "error";
  queuedAt: number;
  started: number; // when it began running
  finished?: number;
  log: string[];
  summary?: string;
  usage?: Usage;
  files?: string[];
  entry?: string; // history id of the version this change made
  before?: string; // history id of the version just before it (what "Undo this" goes back to)
  session?: string; // Claude Code session, for follow-ups in project mode
  needs?: { packages: string[]; files: string[]; newFiles: string[]; why?: string }; // part mode: what it asked for
  error?: string;
  stopped?: boolean; // the person pressed Stop
  undone?: boolean; // not in the page now: worked out from History for every answer (history.ts withState), kept in old cards
  kept?: boolean; // the person pressed Keep: reviewed, so the card rests in the resolved list
  thread: string; // the card it belongs to: the first try's id
  model: string;
  effort: string;
  try: number; // 1 for the first request, 2+ for refinements
  retried?: boolean; // asked again because another change landed in the same place
  progress: {
    phase: "preparing" | "thinking" | "writing" | "applying" | "checking" | "fixing" | "working";
    written: number; // characters of answer so far
    lastAt: number;
    writingSince?: number; // when the answer started coming in (for the time estimate)
  };
  eta?: { seconds: number; outputChars: number; basis: string }; // expected run time, learned from past runs
  context?: { file: string; note: string; chars: number }[]; // what was sent (automatic or picked)
  partId?: string;
  mapChanged?: boolean; // the change added or removed layers: the editor offers to reload its layer list
  added?: string[]; // ids of the layers it added, for the panel to look for on the page
  // What the panel saw on the page once the change had landed (the server can't see the page): a line for the card
  // when the page doesn't bear the change out ("" when it does), and the width it looked at
  observed?: { at: number; width: number; note: string };
  saved?: number; // tokens it saved against a Claude Code run through the project (savings.ts)
  direct?: boolean; // written by the inspector itself (typed words, a link, a slider): no Claude call
  counted?: boolean; // already in the running totals
};

export const MAX_PARALLEL = 3; // Claude Code calls at once: enough to keep working, few enough not to burn through a plan
export const KEEP_FINISHED = 12; // finished changes the panel can still show
export const KEEP_RESOLVED = 60; // resolved cards (kept or taken out) the panel still lists
export const jobs: Job[] = []; // oldest first
export const procs = new Map<string, ChildProcess>(); // running Claude Code processes by job, for Stop

export type RunRequest = {
  mode: Mode;
  part: string;
  prompt: string; // the build prompt's lines for this part
  request: string;
  partId?: string; // part mode: the map part (its context is worked out automatically)
  files?: string[]; // part mode: files picked by hand instead (sent whole)
  alsoFiles?: string[]; // part mode: whole files to send on top of the automatic context (approved in a needs list)
  // part mode: the CSS rules the page applies to the part, as the panel saw them (which stylesheet, which rule)
  page?: { rules: { source: string; selector: string; nth: number; around?: boolean }[] };
  previous?: string; // part mode follow-up: Claude's last answer
  thread?: string; // a refinement: the card it continues (its earlier tries are sent as context)
  session?: string; // project mode follow-up
  model: string;
  effort: string;
  budget?: number; // project mode, USD
  packages?: string[]; // part mode: packages the user approved for this change
  allowNew?: boolean; // part mode: the user approved new files under src/
};
