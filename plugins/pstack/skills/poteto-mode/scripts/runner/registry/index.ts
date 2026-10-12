import { ACCESS_MODES, EFFORTS, PARENTS, type Parent, UsageError } from "../types.ts";
import { isRevision, type Lane, type ProviderAdapter } from "./contract.ts";
import type { FamilyEntry, KeptPredecessor, ReleasedPair, RoleDefault } from "./family.ts";
import { FAMILIES, type FamilyName, RELEASED_PAIRS, ROLE_DEFAULTS } from "./models.ts";
import { ADAPTERS } from "./providers.ts";

export type { Lane, LaunchFacts, ParseResult } from "./contract.ts";

/** The only registry module code outside registry/ imports. */
export interface Registry {
  readonly families: readonly FamilyEntry[];
  readonly adapters: readonly ProviderAdapter[];
  readonly roleDefaults: readonly RoleDefault<FamilyName>[];
  readonly releasedPairs: readonly ReleasedPair<FamilyName>[];
}
export const REGISTRY: Registry = {
  families: FAMILIES,
  adapters: ADAPTERS,
  roleDefaults: ROLE_DEFAULTS,
  releasedPairs: RELEASED_PAIRS,
};

/** Raw CLI strings. Path validation stays in run.ts; resolveLane does no filesystem access. */
export interface LaneRequest {
  readonly parent: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly mode: string;
  readonly promptPath: string;
  readonly cwd: string;
  readonly outputPath: string;
  readonly receiptPath: string;
  readonly timeoutMs: number | null;
}

export type ModelMatch =
  | { readonly kind: "current"; readonly family: FamilyEntry }
  | { readonly kind: "kept"; readonly family: FamilyEntry; readonly predecessor: KeptPredecessor }
  | { readonly kind: "stale-revision"; readonly family: FamilyEntry } // the parent must normalize first
  | { readonly kind: "unregistered" };

/** Precedence: an exact family model, then a kept predecessor, then a rolling revision pattern.
 *  A registered exact pin therefore wins over the pattern. */
export function resolveModel(provider: string, model: string): ModelMatch {
  const families = REGISTRY.families.filter((entry) => entry.provider === provider);
  const current = families.find((entry) => entry.model === model);
  if (current !== undefined) return { kind: "current", family: current };
  for (const entry of families) {
    const predecessor = entry.predecessors?.find((kept) => kept.model === model);
    if (predecessor !== undefined) return { kind: "kept", family: entry, predecessor };
  }
  const stale = families.find((entry) => entry.rolling !== undefined && isRevision(entry.rolling, model));
  return stale === undefined ? { kind: "unregistered" } : { kind: "stale-revision", family: stale };
}

function oneOf<T extends string>(name: string, value: string, choices: readonly T[]): T {
  if (!choices.includes(value as T)) {
    throw new UsageError(`${name} must be one of: ${choices.join(", ")}`);
  }
  return value as T;
}

/** Raw request → Lane, or a UsageError. An unregistered pair runs unchanged. */
export function resolveLane(request: LaneRequest): Lane {
  const mode = oneOf("mode", request.mode, ACCESS_MODES);
  const parent = oneOf("parent", request.parent, Object.keys(PARENTS) as Parent[]);
  const adapter = REGISTRY.adapters.find((entry) => entry.id === request.provider);
  if (adapter === undefined) {
    throw new UsageError(`provider must be one of: ${REGISTRY.adapters.map((entry) => entry.id).join(", ")}`);
  }
  if (request.model.trim().length === 0) throw new UsageError("model is required");
  const effort = oneOf("effort", request.effort, EFFORTS);
  if (adapter.id === parent) {
    throw new UsageError(
      `provider ${adapter.id} is native to parent ${parent}; use the parent subagent primitive`
    );
  }
  const match = resolveModel(adapter.id, request.model);
  if (match.kind === "stale-revision") {
    throw new UsageError(
      `Claude model ${request.model} is a version pin; normalize it to ${match.family.model} before invoking the runner`
    );
  }
  const family = match.kind === "unregistered" ? null : match.family;
  const offered = match.kind === "kept" ? match.predecessor.efforts : family?.efforts ?? EFFORTS;
  if (!offered.includes(effort)) {
    throw new UsageError(
      `effort ${effort} is not offered for ${adapter.id}:${request.model}; choose one of: ${offered.join(", ")}`
    );
  }
  return {
    parent,
    adapter,
    family: family === null ? null : {
      name: family.name,
      label: family.label,
      model: family.model,
      rolling: family.rolling ?? null,
    },
    model: request.model,
    effort,
    access: { mode },
    promptPath: request.promptPath,
    cwd: request.cwd,
    outputPath: request.outputPath,
    receiptPath: request.receiptPath,
    timeoutMs: request.timeoutMs,
  } as Lane;
}

/** "provider:model@defaultEffort". */
export function defaultDescriptor(family: FamilyEntry): string {
  return `${family.provider}:${family.model}@${family.defaultEffort}`;
}
