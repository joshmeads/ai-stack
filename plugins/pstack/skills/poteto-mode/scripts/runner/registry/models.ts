import { family, type ReleasedPair, type RoleDefault } from "./family.ts";

const UP_TO_MAX = ["low", "medium", "high", "xhigh", "max"] as const;
const UP_TO_ULTRA = [...UP_TO_MAX, "ultra"] as const;

export const FAMILIES = [
  family({
    name: "fable",
    label: "Fable",
    provider: "claude",
    model: "fable",
    efforts: UP_TO_MAX,
    defaultEffort: "max",
    upstream: null,
    rolling: { revisionPrefix: "claude-fable-" },
  }),
  family({
    name: "sol",
    label: "GPT-6.1 Sol",
    provider: "codex",
    model: "gpt-6.1-sol",
    efforts: UP_TO_ULTRA, // `codex debug models`, Codex CLI 0.159.0
    defaultEffort: "max",
    upstream: "gpt-5.6-sol-max",
    predecessors: [{ model: "gpt-5.6-sol", efforts: UP_TO_ULTRA }],
  }),
  family({
    name: "grok",
    label: "Grok 4.7",
    provider: "grok",
    model: "grok-4.7",
    efforts: UP_TO_MAX,
    defaultEffort: "xhigh",
    upstream: "grok-4.7-xhigh-fast",
    predecessors: [{ model: "grok-4.6", efforts: UP_TO_MAX }], // written before v1.5.0
  }),
  family({
    name: "opus",
    label: "Opus",
    provider: "claude",
    model: "opus",
    efforts: UP_TO_MAX,
    defaultEffort: "max",
    upstream: "opus",
    rolling: { revisionPrefix: "claude-opus-" },
  }),
  family({
    name: "luna",
    label: "GPT-6 Luna",
    provider: "codex",
    model: "gpt-6-luna",
    efforts: UP_TO_MAX, // no ultra in `codex debug models`, Codex CLI 0.159.0
    defaultEffort: "max",
    upstream: null,
  }),
  family({
    name: "sonnet",
    label: "Sonnet",
    provider: "claude",
    model: "sonnet",
    efforts: UP_TO_MAX,
    defaultEffort: "max",
    upstream: null,
    rolling: { revisionPrefix: "claude-sonnet-" },
  }),
  family({
    name: "opus-5-5",
    label: "Opus 5.5",
    provider: "claude",
    model: "claude-opus-5-5", // an exact pin: resolveModel matches it before the opus revision pattern
    efforts: UP_TO_MAX,
    defaultEffort: "max",
    upstream: "claude-opus-5-5-xhigh",
  }),
  family({
    name: "swe-2",
    label: "SWE-2",
    provider: "devin",
    model: "swe-2",
    // `devin models list --format json`, Devin CLI 3000.10.21: no low variant. The bare slug runs swe-2-max.
    efforts: { medium: "swe-2-medium", high: "swe-2-high", max: "swe-2-max" },
    defaultEffort: "max",
    upstream: null,
  }),
  family({
    name: "swe-1.6",
    label: "SWE-1.6",
    provider: "devin",
    model: "swe-1.6",
    efforts: { default: "swe-1-6" }, // the family's single variant
    defaultEffort: "default",
    upstream: null,
  }),
] as const;
export type FamilyName = (typeof FAMILIES)[number]["name"];

const PANEL = ["opus", "sol", "grok"] as const;
export const ROLE_DEFAULTS = [
  { role: "feature, refactoring", lanes: ["grok"] },
  { role: "bug-fix", lanes: ["sol"] },
  { role: "perf-issue", lanes: ["sol"] },
  { role: "hillclimb", lanes: ["sol"] },
  { role: "judgment and prose", lanes: ["opus"] },
  { role: "hardest tasks", lanes: ["opus"] },
  { role: "how explorer", lanes: ["grok"] },
  { role: "how explainer", lanes: ["opus"] },
  { role: "why investigators, synthesizer", lanes: ["inherit-parent"] },
  { role: "reflect tooling, judgment, divergent, synthesizer", lanes: ["inherit-parent"] },
  { role: "arena runners", lanes: PANEL },
  { role: "arena cross-judge pool", lanes: PANEL },
  { role: "swarm workers", lanes: ["grok"] },
  { role: "architect runners", lanes: PANEL },
  { role: "interrogate reviewers", lanes: PANEL },
] as const satisfies readonly RoleDefault<FamilyName>[];

/** Append-only. Every pair any model-matrix revision on main contained. */
export const RELEASED_PAIRS = [
  { pair: "claude:claude-fable-5", family: "fable" },
  { pair: "claude:claude-opus-5", family: "opus" },
  { pair: "claude:fable", family: "fable" },
  { pair: "claude:opus", family: "opus" },
  { pair: "codex:gpt-5.6-sol", family: "sol" },
  { pair: "codex:gpt-6.1-sol", family: "sol" },
  { pair: "grok:grok-4.6", family: "grok" },
  { pair: "grok:grok-4.7", family: "grok" },
  { pair: "codex:gpt-6-luna", family: "luna" },
  { pair: "claude:sonnet", family: "sonnet" },
  { pair: "claude:claude-opus-5-5", family: "opus-5-5" },
  { pair: "devin:swe-2", family: "swe-2" },
  { pair: "devin:swe-1.6", family: "swe-1.6" },
] as const satisfies readonly ReleasedPair<FamilyName>[];
