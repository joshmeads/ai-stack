import { EFFORTS, type Effort } from "../types.ts";
import type { RollingAlias } from "./contract.ts";
import type { ADAPTERS } from "./providers.ts";

export type ProviderId = (typeof ADAPTERS)[number]["id"];
type EffortInOf<P extends ProviderId> = Extract<(typeof ADAPTERS)[number], { readonly id: P }>["effortIn"];

export interface KeptPredecessor {
  readonly model: string;
  /** The efforts setup accepts for this model today. Never inherited implicitly from the current model. */
  readonly efforts: readonly Effort[];
}

interface FamilyCommon<P extends ProviderId> {
  /** The key role defaults name. A Claude family's native agents are pstack-<name>-<effort>. */
  readonly name: string;
  /** The matrix label. */
  readonly label: string;
  readonly provider: P;
  /** The descriptor's model component. */
  readonly model: string;
  readonly defaultEffort: Effort;
  /** Cursor's selector for the same choice, kept for sync review. */
  readonly upstream: string | null;
  /** Present for Claude rolling aliases. Drives report matching and read-time normalization. */
  readonly rolling?: RollingAlias;
}

type ModelIds = { readonly [E in Effort]?: string };

/** The provider picks the effort shape, so a Sol-shaped entry for a model-ID provider fails `tsc`.
 *  A model-ID family keeps no predecessor yet: no released pair of one has changed its model. */
export type FamilyEntry<P extends ProviderId = ProviderId> = P extends ProviderId
  ? FamilyCommon<P> & (EffortInOf<P> extends "model-id"
    ? { readonly efforts: ModelIds; readonly predecessors?: never }
    : { readonly efforts: readonly Effort[]; readonly predecessors?: readonly KeptPredecessor[] })
  : never;

/** A model-ID family's map from effort to CLI model ID, or null for a family whose argv carries the effort. */
export function modelIds(entry: FamilyEntry): ModelIds | null {
  return Array.isArray(entry.efforts) ? null : entry.efforts as ModelIds;
}

/** A family's selectable efforts, in EFFORTS order for a model-ID family. */
export function effortsOf(entry: FamilyEntry): readonly Effort[] {
  const ids = modelIds(entry);
  return ids === null ? entry.efforts as readonly Effort[] : EFFORTS.filter((effort) => ids[effort] !== undefined);
}

export type LaneDefault<F extends string> = F | "inherit-parent" | "auto";

/** One model-sheet line: the role label users write, and its lanes in order. */
export interface RoleDefault<F extends string = string> {
  readonly role: string;
  readonly lanes: readonly LaneDefault<F>[];
}

/** A pair any model-matrix revision on main contained, and the family it must keep resolving to. */
export interface ReleasedPair<F extends string = string> {
  readonly pair: `${ProviderId}:${string}`;
  readonly family: F;
}

export function family<const F extends FamilyEntry>(entry: F): F {
  return entry;
}
