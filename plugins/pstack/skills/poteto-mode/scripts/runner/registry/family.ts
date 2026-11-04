import { EFFORTS, type Effort } from "../types.ts";
import type { RollingAlias } from "./contract.ts";
import type { ADAPTERS } from "./providers.ts";

export type ProviderId = (typeof ADAPTERS)[number]["id"];
type EffortInOf<P extends ProviderId> = Extract<(typeof ADAPTERS)[number], { readonly id: P }>["effortIn"];

export interface KeptPredecessor {
  readonly model: string;
  readonly efforts: readonly Effort[];
}

interface FamilyCommon<P extends ProviderId> {
  readonly name: string;
  readonly label: string;
  readonly provider: P;
  readonly model: string;
  readonly defaultEffort: Effort;
  readonly upstream: string | null;
  readonly rolling?: RollingAlias;
}

type ModelIds = { readonly [E in Effort]?: string };

export type FamilyEntry<P extends ProviderId = ProviderId> = P extends ProviderId
  ? FamilyCommon<P> & (EffortInOf<P> extends "model-id"
    ? { readonly efforts: ModelIds; readonly predecessors?: never }
    : { readonly efforts: readonly Effort[]; readonly predecessors?: readonly KeptPredecessor[] })
  : never;

export function modelIds(entry: FamilyEntry): ModelIds | null {
  return Array.isArray(entry.efforts) ? null : entry.efforts as ModelIds;
}

export function effortsOf(entry: FamilyEntry): readonly Effort[] {
  const ids = modelIds(entry);
  return ids === null ? entry.efforts as readonly Effort[] : EFFORTS.filter((effort) => ids[effort] !== undefined);
}

export type LaneDefault<F extends string> = F | "inherit-parent" | "auto";

export interface RoleDefault<F extends string = string> {
  readonly role: string;
  readonly lanes: readonly LaneDefault<F>[];
}

export interface ReleasedPair<F extends string = string> {
  readonly pair: `${ProviderId}:${string}`;
  readonly family: F;
}

export function family<const F extends FamilyEntry>(entry: F): F {
  return entry;
}
