import { rememberBefore, sitePage } from "./observe";
import { rulesFor, type RuleRef } from "./pageRules";

// The CSS rules the page applies to a part, sent with a change so Claude gets those and not a guess (pageRules.ts).
// Asked again at most every two seconds per part: the estimate under the chat bar asks as you type.
const asked = new Map<string, { at: number; rules: RuleRef[] }>();
export function pageFacts(partId: string): { rules: RuleRef[] } | undefined {
  const kept = asked.get(partId);
  if (kept && Date.now() - kept.at < 2000) return kept.rules.length ? { rules: kept.rules } : undefined;
  const rules = rulesFor(sitePage(), partId);
  asked.set(partId, { at: Date.now(), rules });
  return rules.length ? { rules } : undefined;
}
// For the sites suite, which sends requests without the chat bar: the same facts the chat bar would send
(window as unknown as { __inspectorPageFacts?: typeof pageFacts }).__inspectorPageFacts = pageFacts;
import { api } from "./api";
import { useEffect, useState } from "react";
import { EXTRA_FILES, type Part } from "./parts";
import type { Job, Jobs, Mode } from "./jobs";

// Asking Claude for a change, shared by the chat bar (where you type it) and the part's "Latest change" block (where a
// change that needs a package or another file is allowed and run again):
// - A part's change is one call: Claude gets only this part's prompt lines, the request and its context (picked
//   automatically, or by hand), and answers with exact edits. If it needs more (a package, another file, a new file),
//   it lists exactly that instead; you tick what to allow and run it again, still as one call.
// - "Whole site" runs Claude Code as an agent across the project, under a budget you pick, and runs alone.

export const MODELS = [
  { id: "claude-fable-5-2", label: "Fable 5.2" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];
export const EFFORTS = ["low", "medium", "high"];
export const BUDGETS = [0.5, 1, 2, 5, 0];
export const FIXED_TOKENS = 3000; // every part run: the endpoint's instructions plus what Claude Code adds (measured 2026-11-12)
export const BYTES_PER_TOKEN = 3.6;
// A file a change can touch, as the server's own rule (site.ts EDITABLE) has it, less the package files and the map:
// src/ files in a Vite project, and any page, stylesheet or script in a site with no build step (coffee-shop.html,
// public/styles.css)
export const CODE_FILE = /^(?!\.inspector\/|node_modules\/|dist\/)(?!(package(-lock)?|inspector\.map)\.json$)[\w./ -]+\.(tsx?|jsx?|mjs|cjs|css|json|html?)$/;

export type Extras = { packages: string[]; files: string[]; allowNew: boolean };
export const NO_EXTRAS: Extras = { packages: [], files: [], allowNew: false };

// How changes run, picked in the chat bar and used by every run from the editor
export type Settings = { model: string; effort: string; budget: number };
// Opus 5.5 is where a new site starts: the savings test ran on it (docs/methodology.md). The list above is by size.
export const DEFAULT_SETTINGS: Settings = { model: "claude-opus-5-5", effort: "medium", budget: 1 };

export const promptText = (part: Part) =>
  [...part.prompt.map((r) => `${r.where}: ${r.text}`), ...(part.note ? [part.note] : [])].join("\n");

export const modeOf = (part: Part): Mode => (part.id === "site" ? "project" : "part");

// This part's changes, newest first (Whole site: every whole-project change)
export const changesOf = (part: Part, jobs: Jobs) =>
  jobs.jobs.filter((j) => (part.id === "site" ? j.mode === "project" : j.partId === part.id));

type Run = {
  part: Part;
  request: string;
  continuing: Job | null; // a reply refines that change: the dev server sends its earlier tries
  settings: Settings;
  manual: string[] | null; // files picked by hand; null: automatic context
  extras?: Extras;
  jobs: Jobs;
};

// Queue a change. Returns the hand-picked files as they should be after it (allowed files join them).
export async function startChange({ part, request, continuing, settings, manual, extras = NO_EXTRAS, jobs }: Run): Promise<string[] | null> {
  const mode = modeOf(part);
  if (mode === "part") rememberBefore(part.id); // how the part looks now, to compare once the change is on the page
  const sendFiles = manual ? [...new Set([...manual, ...extras.files])] : null;
  const res = await api("/__inspector/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      part: part.label,
      prompt: promptText(part),
      request,
      partId: mode === "part" ? part.id : undefined,
      page: mode === "part" && !sendFiles ? pageFacts(part.id) : undefined,
      files: mode === "part" ? (sendFiles ?? undefined) : undefined,
      alsoFiles: mode === "part" && !manual && extras.files.length ? extras.files : undefined,
      packages: extras.packages.length ? extras.packages : undefined,
      allowNew: extras.allowNew || undefined,
      thread: continuing?.thread,
      model: settings.model,
      effort: settings.effort,
      budget: mode === "project" && settings.budget ? settings.budget : undefined,
    }),
  });
  const out = (await res.json()) as { ok: true; job: Job } | { ok: false; error: string };
  if (!out.ok) throw new Error(out.error);
  await jobs.refresh();
  return sendFiles;
}

// Byte sizes of files as they'd be sent (embedded data left out), for token estimates
export function useSizes(files: string[], key: unknown): Record<string, number> {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const list = [...new Set(files)].sort().join(",");
  useEffect(() => {
    if (!list) return setSizes({});
    api(`/__inspector/sizes?files=${encodeURIComponent(list)}`)
      .then((r) => r.json() as Promise<{ sizes: Record<string, number> }>)
      .then((d) => setSizes(d.sizes))
      .catch(() => setSizes({}));
  }, [list, key]);
  return sizes;
}

export const tokensFor = (part: Part, request: string, list: string[], sizes: Record<string, number>) =>
  Math.round(FIXED_TOKENS + (promptText(part).length + request.length) / 4 + list.reduce((n, f) => n + (sizes[f] ?? 0), 0) / BYTES_PER_TOKEN);

export const optionsFor = (part: Part, files: string[]) => [...new Set([...part.edit, ...files, ...EXTRA_FILES])];
